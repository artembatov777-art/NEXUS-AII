use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderInputMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProviderMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ProviderMessage,
}


#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMessage {
    id: String,
    role: String,
    content: String,
    created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_references: Option<serde_json::Value>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConversation {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    project_id: Option<String>,
    messages: Vec<StoredMessage>,
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProject {
    id: String,
    name: String,
    description: String,
    created_at: i64,
    updated_at: i64,
    archived: bool,
    schema_version: i64,
}


fn valid_memory_record(record: &serde_json::Value) -> bool {
    let id=record.get("id").and_then(|v|v.as_str());
    let content=record.get("content").and_then(|v|v.as_str());
    let category=record.get("category").and_then(|v|v.as_str());
    let scope=record.get("scope").and_then(|v|v.as_str());
    let source=record.get("source");
    let tags=record.get("tags").and_then(|v|v.as_array());
    let valid_source=source.map_or(false,|v|{
        let kind=v.get("type").and_then(|x|x.as_str());
        let label=v.get("label").and_then(|x|x.as_str());
        ["user_confirmed","conversation","import"].contains(&kind.unwrap_or("")) && label.map_or(false,|x|!x.trim().is_empty()&&x.len()<=200)
    });
    id.map_or(false,|v|!v.is_empty()&&v.len()<=128)
        && content.map_or(false,|v|!v.trim().is_empty()&&v.len()<=4000)
        && ["preference","goal","fact","workflow","project"].contains(&category.unwrap_or(""))
        && ["profile","project","conversation"].contains(&scope.unwrap_or(""))
        && record.get("createdAt").and_then(|v|v.as_i64()).is_some()
        && record.get("updatedAt").and_then(|v|v.as_i64()).is_some()
        && record.get("schemaVersion").and_then(|v|v.as_i64())==Some(1)
        && valid_source
        && tags.map_or(false,|items|items.len()<=20&&items.iter().all(|v|v.as_str().map_or(false,|x|x.len()<=64)))
        && (scope != Some("project") || record.get("projectId").and_then(|v|v.as_str()).map_or(false,|v|!v.is_empty()&&v.len()<=128))
}
fn valid_knowledge_chunk(chunk: &serde_json::Value) -> bool {
    let field=|name:&str,max:usize|chunk.get(name).and_then(|v|v.as_str()).map_or(false,|v|!v.is_empty()&&v.len()<=max);
    field("id",160)&&field("documentId",160)&&field("projectId",128)&&field("text",12000)&&field("sourceLabel",300)
        && chunk.get("page").map_or(true,|v|v.as_u64().map_or(false,|n|n>0))
        && chunk.get("section").map_or(true,|v|v.as_str().map_or(false,|x|x.len()<=300))
}

const MAX_PROVIDER_RESPONSE_BYTES: usize = 2_000_000;
fn append_bounded_response(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if body.len().saturating_add(chunk.len()) > MAX_PROVIDER_RESPONSE_BYTES {
        return Err("Provider response exceeded the 2 MB limit.".into());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

struct AppDatabase(Mutex<Connection>);

type ActiveStreamMap = HashMap<String, Arc<AtomicBool>>;
#[derive(Clone, Default)]
struct ActiveChatStreams(Arc<Mutex<ActiveStreamMap>>);

struct ActiveStreamGuard {
    streams: Arc<Mutex<ActiveStreamMap>>,
    stream_id: String,
}
impl Drop for ActiveStreamGuard {
    fn drop(&mut self) {
        if let Ok(mut streams) = self.streams.lock() {
            streams.remove(&self.stream_id);
        }
    }
}

fn valid_stream_id(stream_id: &str) -> bool {
    !stream_id.is_empty()
        && stream_id.len() <= 128
        && stream_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

async fn wait_for_stream_cancellation(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
}

#[tauri::command]
fn cancel_chat_stream(
    stream_id: String,
    streams: State<'_, ActiveChatStreams>,
) -> Result<bool, String> {
    if !valid_stream_id(&stream_id) {
        return Err("Stream ID is invalid.".into());
    }
    let active = streams.0.lock().map_err(|_| "Stream registry is unavailable.")?;
    if let Some(cancelled) = active.get(&stream_id) {
        cancelled.store(true, Ordering::Release);
        Ok(true)
    } else {
        Ok(false)
    }
}
fn migrate_database(connection: &mut Connection) -> rusqlite::Result<()> {
    // One exclusive transaction serializes concurrent first-launch upgrades and
    // prevents another process from observing a partially migrated schema.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Exclusive)?;
    let mut version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        transaction.execute_batch("CREATE TABLE conversations (id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,project_id TEXT,updated_at INTEGER NOT NULL); CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at INTEGER NOT NULL,source_references TEXT); CREATE INDEX idx_conversations_project_updated ON conversations(project_id,updated_at DESC); CREATE INDEX idx_messages_conversation_created ON messages(conversation_id,created_at);")?;
        version = 1;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 2 {
        transaction.execute_batch("CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,schema_version INTEGER NOT NULL); CREATE INDEX idx_projects_updated ON projects(updated_at DESC);")?;
        version = 2;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 3 {
        transaction.execute_batch("CREATE TABLE memory_records (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, project_id TEXT, updated_at INTEGER NOT NULL, payload TEXT NOT NULL, CHECK(scope != 'project' OR project_id IS NOT NULL)); CREATE INDEX idx_memory_scope_project_updated ON memory_records(scope,project_id,updated_at DESC); CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, payload TEXT NOT NULL); CREATE INDEX idx_knowledge_project_document ON knowledge_chunks(project_id,document_id);")?;
        version = 3;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 4 {
        transaction.execute_batch("CREATE TRIGGER validate_conversation_project_insert BEFORE INSERT ON conversations WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER validate_conversation_project_update BEFORE UPDATE OF project_id ON conversations WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER validate_memory_project_insert BEFORE INSERT ON memory_records WHEN NEW.scope='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER validate_memory_project_update BEFORE UPDATE OF project_id,scope ON memory_records WHEN NEW.scope='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER cleanup_project_data AFTER DELETE ON projects BEGIN DELETE FROM conversations WHERE project_id=OLD.id; DELETE FROM memory_records WHERE project_id=OLD.id; END;")?;
        version = 4;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 5 {
        transaction.execute_batch("CREATE TABLE agent_checkpoints (run_id TEXT PRIMARY KEY NOT NULL,agent_id TEXT NOT NULL,thread_id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence >= 1),status TEXT NOT NULL CHECK(status IN ('running','waiting_for_approval','completed','failed','cancelled')),updated_at REAL NOT NULL,payload TEXT NOT NULL); CREATE INDEX idx_agent_checkpoints_thread_updated ON agent_checkpoints(thread_id,updated_at DESC,run_id);")?;
        version = 5;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 6 {
        transaction.execute_batch("CREATE TABLE tool_audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,tool_id TEXT NOT NULL,run_id TEXT NOT NULL,trace_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('started','completed','failed','denied')),timestamp REAL NOT NULL,detail TEXT); CREATE INDEX idx_tool_audit_run_id ON tool_audit_events(run_id,id DESC); CREATE TABLE trace_events (id INTEGER PRIMARY KEY AUTOINCREMENT,trace_id TEXT NOT NULL,run_id TEXT NOT NULL,parent_trace_id TEXT,name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('started','progress','waiting_for_approval','completed','failed','cancelled')),timestamp REAL NOT NULL,duration_ms REAL,attributes TEXT,payload TEXT NOT NULL); CREATE INDEX idx_trace_events_run_id ON trace_events(run_id,id DESC); CREATE INDEX idx_trace_events_trace_id ON trace_events(trace_id,id DESC);")?;
        version = 6;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 7 {
        transaction.execute_batch("CREATE TABLE training_datasets (id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1), created_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version)); CREATE INDEX idx_training_datasets_created ON training_datasets(created_at DESC); CREATE TABLE training_experiments (id TEXT PRIMARY KEY NOT NULL, dataset_id TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL); CREATE INDEX idx_training_experiments_created ON training_experiments(created_at DESC);")?;
        version = 7;
        transaction.pragma_update(None, "user_version", version)?;
    }
    if version < 8 {
        transaction.execute_batch("ALTER TABLE training_experiments ADD COLUMN dataset_version INTEGER NOT NULL DEFAULT 1;")?;
        version = 8;
        transaction.pragma_update(None, "user_version", version)?;
    }
    transaction.commit()
}


#[tauri::command]
fn load_conversations(database: State<'_, AppDatabase>) -> Result<Vec<StoredConversation>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let metadata = {
        let mut statement = connection.prepare("SELECT id,title,project_id,updated_at FROM conversations ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,i64>(3)?))).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    let mut conversations = Vec::with_capacity(metadata.len());
    for (id,title,project_id,updated_at) in metadata {
        let messages = {
            let mut statement = connection.prepare("SELECT id,role,content,created_at,source_references FROM messages WHERE conversation_id=?1 ORDER BY created_at,rowid").map_err(|e| e.to_string())?;
            let rows = statement.query_map(params![id], |row| {
                let source_json: Option<String> = row.get(4)?;
                Ok(StoredMessage { id: row.get(0)?, role: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?, source_references: source_json.and_then(|json| serde_json::from_str(&json).ok()) })
            }).map_err(|e| e.to_string())?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
        };
        conversations.push(StoredConversation { id,title,project_id,messages,updated_at });
    }
    Ok(conversations)
}


#[tauri::command]
fn save_conversations(database: State<'_, AppDatabase>, conversations: Vec<StoredConversation>) -> Result<(), String> {
    if conversations.len() > 10000 { return Err("Too many conversations to save.".into()); }
    let ids: HashSet<&str> = conversations.iter().map(|item| item.id.as_str()).collect();
    if ids.len() != conversations.len() { return Err("Conversation IDs must be unique.".into()); }
    let mut connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    for conversation in &conversations {
        if conversation.id.is_empty() || conversation.id.len() > 128 || conversation.title.len() > 120 || conversation.messages.len() > 20000 {
            return Err("Conversation data exceeds database limits.".into());
        }
        transaction.execute("INSERT INTO conversations(id,title,project_id,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,project_id=excluded.project_id,updated_at=excluded.updated_at", params![conversation.id,conversation.title,conversation.project_id,conversation.updated_at]).map_err(|e| e.to_string())?;
        transaction.execute("DELETE FROM messages WHERE conversation_id=?1", params![conversation.id]).map_err(|e| e.to_string())?;
        for message in &conversation.messages {
            if message.id.is_empty() || message.id.len() > 128 || message.content.len() > 100000 || (message.role != "user" && message.role != "assistant") {
                return Err("Message data is invalid or exceeds database limits.".into());
            }
            let source_json = message.source_references.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?;
            transaction.execute("INSERT INTO messages(id,conversation_id,role,content,created_at,source_references) VALUES(?1,?2,?3,?4,?5,?6)", params![message.id,conversation.id,message.role,message.content,message.created_at,source_json]).map_err(|e| e.to_string())?;
        }
    }
    let existing: Vec<String> = {
        let mut statement = transaction.prepare("SELECT id FROM conversations").map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    for id in existing {
        if !ids.contains(id.as_str()) {
            transaction.execute("DELETE FROM conversations WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        }
    }
    transaction.commit().map_err(|e| e.to_string())
}


#[tauri::command]
fn load_projects(database: State<'_, AppDatabase>) -> Result<Vec<StoredProject>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let mut statement = connection.prepare("SELECT id,name,description,created_at,updated_at,archived,schema_version FROM projects ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(StoredProject {
        id: row.get(0)?, name: row.get(1)?, description: row.get(2)?, created_at: row.get(3)?,
        updated_at: row.get(4)?, archived: row.get::<_,i64>(5)? != 0, schema_version: row.get(6)?
    })).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(database: State<'_, AppDatabase>, project: StoredProject) -> Result<(), String> {
    if project.id.is_empty() || project.id.len() > 128 || project.name.trim().is_empty() || project.name.len() > 80 || project.description.len() > 500 || project.schema_version != 1 {
        return Err("Project data is invalid or exceeds limits.".into());
    }
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    connection.execute("INSERT INTO projects(id,name,description,created_at,updated_at,archived,schema_version) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=excluded.updated_at,archived=excluded.archived,schema_version=excluded.schema_version", params![project.id,project.name,project.description,project.created_at,project.updated_at,project.archived as i64,project.schema_version]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_project(database: State<'_, AppDatabase>, id: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 { return Err("Project ID is invalid.".into()); }
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    connection.execute("DELETE FROM projects WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}


#[tauri::command]
fn load_memories(database: State<'_, AppDatabase>) -> Result<Vec<serde_json::Value>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let mut statement = connection.prepare("SELECT payload FROM memory_records ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|e| e.to_string())?;
        serde_json::from_str(&payload).map_err(|e| e.to_string())
    }).collect()
}

#[tauri::command]
fn save_memory(database: State<'_, AppDatabase>, record: serde_json::Value) -> Result<(), String> {
    if !valid_memory_record(&record) { return Err("Memory data is invalid or exceeds limits.".into()); }
    let id=record["id"].as_str().unwrap();
    let scope=record["scope"].as_str().unwrap();
    let project_id=record.get("projectId").and_then(|v|v.as_str());
    let updated_at=record["updatedAt"].as_i64().unwrap();
    let payload=serde_json::to_string(&record).map_err(|e|e.to_string())?;
    let connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    connection.execute("INSERT INTO memory_records(id,scope,project_id,updated_at,payload) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,project_id=excluded.project_id,updated_at=excluded.updated_at,payload=excluded.payload",params![id,scope,project_id,updated_at,payload]).map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_memory(database: State<'_, AppDatabase>, id: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 { return Err("Memory ID is invalid.".into()); }
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    connection.execute("DELETE FROM memory_records WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_knowledge_chunks(database: State<'_, AppDatabase>) -> Result<Vec<serde_json::Value>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let mut statement = connection.prepare("SELECT payload FROM knowledge_chunks ORDER BY rowid").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|e| e.to_string())?;
        serde_json::from_str(&payload).map_err(|e| e.to_string())
    }).collect()
}

#[tauri::command]
fn save_knowledge_chunks(database: State<'_, AppDatabase>, chunks: Vec<serde_json::Value>) -> Result<(), String> {
    if chunks.len()>50000 { return Err("Knowledge base exceeds the chunk limit.".into()); }
    let mut ids=HashSet::new();
    let mut total_bytes:usize=0;
    for chunk in &chunks {
        if !valid_knowledge_chunk(chunk) { return Err("Knowledge chunk is invalid or exceeds limits.".into()); }
        if !ids.insert(chunk["id"].as_str().unwrap().to_string()) { return Err("Knowledge chunk IDs must be unique.".into()); }
        total_bytes=total_bytes.saturating_add(chunk["text"].as_str().unwrap().len());
        if total_bytes>50_000_000 { return Err("Knowledge base exceeds the 50 MB text limit.".into()); }
    }
    let mut connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    let transaction=connection.transaction().map_err(|e|e.to_string())?;
    for chunk in chunks {
        let payload=serde_json::to_string(&chunk).map_err(|e|e.to_string())?;
        transaction.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id,project_id=excluded.project_id,payload=excluded.payload",params![chunk["id"].as_str().unwrap(),chunk["documentId"].as_str().unwrap(),chunk["projectId"].as_str().unwrap(),payload]).map_err(|e|e.to_string())?;
    }
    transaction.commit().map_err(|e|e.to_string())
}

fn replace_knowledge_document_record(connection: &mut Connection, document_id: String, project_id: String, chunks: Vec<serde_json::Value>) -> Result<(), String> {
    if document_id.is_empty() || document_id.len()>160 || project_id.is_empty() || project_id.len()>128 || chunks.len()>5000 {
        return Err("Knowledge document replacement exceeds limits.".into());
    }
    let mut ids=HashSet::new();
    let mut total_bytes=0usize;
    for chunk in &chunks {
        if !valid_knowledge_chunk(chunk) || chunk["documentId"].as_str()!=Some(document_id.as_str()) || chunk["projectId"].as_str()!=Some(project_id.as_str()) {
            return Err("Replacement chunks must belong to the selected document and project.".into());
        }
        if !ids.insert(chunk["id"].as_str().unwrap().to_string()) { return Err("Knowledge chunk IDs must be unique.".into()); }
        total_bytes=total_bytes.saturating_add(chunk["text"].as_str().unwrap().len());
        if total_bytes>10_000_000 { return Err("Document exceeds the 10 MB text limit.".into()); }
    }
    let transaction=connection.transaction().map_err(|e|e.to_string())?;
    transaction.execute("DELETE FROM knowledge_chunks WHERE document_id=?1 AND project_id=?2",params![document_id,project_id]).map_err(|e|e.to_string())?;
    for chunk in chunks {
        let payload=serde_json::to_string(&chunk).map_err(|e|e.to_string())?;
        transaction.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4)",params![chunk["id"].as_str().unwrap(),document_id,project_id,payload]).map_err(|e|e.to_string())?;
    }
    transaction.commit().map_err(|e|e.to_string())
}
#[tauri::command]
fn replace_knowledge_document(database: State<'_, AppDatabase>, document_id: String, project_id: String, chunks: Vec<serde_json::Value>) -> Result<(), String> {
    let mut connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    replace_knowledge_document_record(&mut connection,document_id,project_id,chunks)
}

fn delete_knowledge_document_record(connection: &Connection, document_id: String, project_id: String) -> Result<(), String> {
    if document_id.is_empty() || document_id.len()>160 || project_id.is_empty() || project_id.len()>128 { return Err("Knowledge document identity is invalid.".into()); }
    connection.execute("DELETE FROM knowledge_chunks WHERE document_id=?1 AND project_id=?2",params![document_id,project_id]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
fn delete_knowledge_document(database: State<'_, AppDatabase>, document_id: String, project_id: String) -> Result<(), String> {
    let connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    delete_knowledge_document_record(&connection,document_id,project_id)
}

fn credential_entry(handle: &str) -> Result<keyring::Entry, String> {
    if handle != "default" { return Err("Unknown credential handle.".into()); }
    keyring::Entry::new("com.nexusau.desktop", handle).map_err(|e| format!("OS credential store unavailable: {e}"))
}

fn load_provider_credential(handle: &str, loopback: bool) -> Result<Option<String>, String> {
    if handle == "none" {
        if !loopback { return Err("Unauthenticated providers are allowed only on loopback hosts.".into()); }
        return Ok(None);
    }
    let key = credential_entry(handle)?
        .get_password()
        .map_err(|_| "Save an API key in the OS credential vault first.".to_string())?;
    if key.is_empty() || key.len() > 8192 {
        return Err("Stored provider credential is invalid.".into());
    }
    Ok(Some(key))
}

fn redact_provider_secret(message: &str, api_key: Option<&str>) -> String {
    match api_key.filter(|key| !key.is_empty()) {
        Some(key) => message.replace(key, "[redacted]"),
        None => message.to_string()
    }
}

/// Builds a validated OpenAI-compatible endpoint. HTTP is permitted only for
/// loopback hosts, and redirects are disabled by every provider HTTP client.
fn provider_endpoint(base_url: &str, suffix: &str) -> Result<(reqwest::Url, bool), String> {
    if !matches!(suffix, "chat/completions" | "models") {
        return Err("Provider endpoint path is unsupported.".into());
    }
    let (endpoint, loopback) = provider_endpoint(&base_url, "chat/completions")?;
    if model.trim().is_empty() || model.len() > 128 || messages.is_empty() || messages.len() > 100 {
        return Err("A valid model and between 1 and 100 messages are required.".into());
    }
    let mut total_bytes = 0usize;
    for message in &messages {
        if !["system", "user", "assistant"].contains(&message.role.as_str())
            || message.content.len() > 100_000 {
            return Err("Chat message role or content is invalid.".into());
        }
        total_bytes = total_bytes.saturating_add(message.content.len());
        if total_bytes > 1_000_000 {
            return Err("Chat request exceeds the 1 MB content limit.".into());
        }
    }
    let api_key = load_provider_credential(&credential_handle, loopback)?;
    let payload = serde_json::json!({
        "model": model.trim(),
        "messages": messages.iter().map(|m| serde_json::json!({"role":m.role,"content":m.content})).collect::<Vec<_>>(),
        "stream": true
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| format!("Could not configure provider client: {e}"))?;
    let mut request = client.post(endpoint).json(&payload);
    if let Some(key) = api_key.as_deref() { request = request.bearer_auth(key); }
    let send_result = tokio::select! {
        result = request.send() => result,
        _ = wait_for_stream_cancellation(cancelled.clone()) => return Err("Provider streaming request cancelled.".into())
    };
    let mut response = send_result
        .map_err(|e| format!("Provider streaming request failed: {e}"))?;
    let status = response.status();
    if response.content_length().map_or(false, |length| length > MAX_PROVIDER_RESPONSE_BYTES as u64) {
        return Err("Provider stream exceeded the 2 MB limit.".into());
    }
    if !status.is_success() {
        let mut body=Vec::new();
        loop {
            let next_chunk = tokio::select! {
                chunk = response.chunk() => chunk.map_err(|e| format!("Could not read provider error: {e}"))?,
                _ = wait_for_stream_cancellation(cancelled.clone()) => return Err("Provider streaming request cancelled.".into())
            };
            let Some(chunk) = next_chunk else { break; };
            append_bounded_response(&mut body, &chunk)?;
        }
        let raw=String::from_utf8_lossy(&body).replace(&api_key,"[redacted]");
        return Err(format!("Provider returned HTTP {status}: {}",raw.chars().take(500).collect::<String>()));
    }

    let mut pending=Vec::<u8>::new();
    let mut event_data=String::new();
    let mut total=0usize;
    let mut completed=false;
    let mut finish_reason: Option<String> = None;
    loop {
        let next_chunk = tokio::select! {
            chunk = response.chunk() => chunk.map_err(|e| format!("Provider stream read failed: {e}"))?,
            _ = wait_for_stream_cancellation(cancelled.clone()) => return Err("Provider streaming request cancelled.".into())
        };
        let Some(chunk) = next_chunk else { break; };
        total=total.saturating_add(chunk.len());
        if total>MAX_PROVIDER_RESPONSE_BYTES { return Err("Provider stream exceeded the 2 MB limit.".into()); }
        pending.extend_from_slice(&chunk);
        if pending.len()>65_536 && !pending.contains(&b'\n') {
            return Err("Provider stream event exceeded the 64 KB limit.".into());
        }
        while let Some(newline)=pending.iter().position(|byte|*byte==b'\n') {
            let mut line=pending.drain(..=newline).collect::<Vec<_>>();
            if line.last()==Some(&b'\n') { line.pop(); }
            if line.last()==Some(&b'\r') { line.pop(); }
            if line.is_empty() {
                if !event_data.is_empty() {
                    let data=event_data.trim_end_matches('\n').to_string();
                    event_data.clear();
                    if forward_sse_chunk(&on_event, &data, &mut finish_reason, api_key.as_deref())? {
                        on_event.send(serde_json::json!({"type":"completed","finishReason":finish_reason.as_deref().unwrap_or("unknown")}))
                            .map_err(|_| "The chat stream consumer disconnected.".to_string())?;
                        completed=true;
                        break;
                    }
                }
            } else if line.starts_with(b"data:") {
                let value=String::from_utf8_lossy(&line[5..]).trim_start().to_string();
                if event_data.len().saturating_add(value.len())>65_536 {
                    return Err("Provider stream event exceeded the 64 KB limit.".into());
                }
                event_data.push_str(&value);
                event_data.push('\n');
            } else if !line.starts_with(b":") && !line.starts_with(b"event:") && !line.starts_with(b"id:") && !line.starts_with(b"retry:") {
                return Err("Provider sent an unsupported SSE field.".into());
            }
        }
        if completed { break; }
    }
    if !completed {
        if !pending.is_empty() {
            let mut final_line = std::mem::take(&mut pending);
            if final_line.last() == Some(&b'\r') { final_line.pop(); }
            if final_line.starts_with(b"data:") {
                let value = String::from_utf8_lossy(&final_line[5..]).trim_start().to_string();
                if event_data.len().saturating_add(value.len()) > 65_536 {
                    return Err("Provider stream event exceeded the 64 KB limit.".into());
                }
                event_data.push_str(&value);
            }
        }
        if !event_data.trim().is_empty() {
            let _ = forward_sse_chunk(&on_event, event_data.trim_end_matches('\n'), &mut finish_reason, api_key.as_deref())?;
        }
        on_event.send(serde_json::json!({"type":"completed","finishReason":finish_reason.as_deref().unwrap_or("unknown")}))
            .map_err(|_| "The chat stream consumer disconnected.".to_string())?;
    }
    Ok(())
}


#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
async fn send_chat(
    base_url: String,
    credential_handle: String,
    model: String,
    messages: Vec<ProviderInputMessage>,
) -> Result<String, String> {
    let (endpoint, loopback) = provider_endpoint(&base_url, "chat/completions")?;
    if model.trim().is_empty() || model.len() > 128 || messages.is_empty() || messages.len() > 100 {
        return Err("A valid model and between 1 and 100 messages are required.".into());
    }
    let mut total_bytes = 0usize;
    for message in &messages {
        if !["system", "user", "assistant"].contains(&message.role.as_str())
            || message.content.len() > 100_000 {
            return Err("Chat message role or content is invalid.".into());
        }
        total_bytes = total_bytes.saturating_add(message.content.len());
        if total_bytes > 1_000_000 {
            return Err("Chat request exceeds the 1 MB content limit.".into());
        }
    }

    let api_key = load_provider_credential(&credential_handle, loopback)?;
    let payload = serde_json::json!({
        "model": model.trim(),
        "messages": messages.iter().map(|m| serde_json::json!({
            "role": m.role,
            "content": m.content
        })).collect::<Vec<_>>()
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Could not configure provider client: {e}"))?;
    let mut request = client.post(endpoint).json(&payload);
    if let Some(key) = api_key.as_deref() { request = request.bearer_auth(key); }
    let mut response = request.send().await
        .map_err(|e| format!("Provider request failed: {e}"))?;
    let status = response.status();
    if response.content_length().map_or(false, |length| length > MAX_PROVIDER_RESPONSE_BYTES as u64) {
        return Err("Provider response exceeded the 2 MB limit.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Could not read provider response: {e}"))? {
        append_bounded_response(&mut body, &chunk)?;
    }
    if !status.is_success() {
        let raw = redact_provider_secret(&String::from_utf8_lossy(&body), api_key.as_deref());
        let excerpt: String = raw.chars().take(500).collect();
        return Err(format!("Provider returned HTTP {status}: {excerpt}"));
    }
    let data: ChatCompletionResponse = serde_json::from_slice(&body)
        .map_err(|e| format!("Could not parse provider response: {e}"))?;
    data.choices.into_iter().next().map(|choice| choice.message.content)
        .ok_or_else(|| "Provider returned an empty response.".into())
}


fn parse_provider_model_ids(body: &[u8]) -> Result<Vec<String>, String> {
    let payload: serde_json::Value = serde_json::from_slice(body)
        .map_err(|_| "Could not parse the provider model catalog.".to_string())?;
    let entries = payload.get("data").and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Provider model catalog must contain a data array.".to_string())?;
    let mut ids: Vec<String> = Vec::new();
    for entry in entries.iter().take(1000) {
        let Some(raw_id) = entry.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let id = raw_id.trim();
        if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
            continue;
        }
        if !ids.iter().any(|existing| existing.as_str() == id) {
            ids.push(id.to_string());
        }
    }
    if ids.is_empty() {
        return Err("Provider returned no usable model IDs.".into());
    }
    Ok(ids)
}

#[tauri::command]
async fn list_provider_models(
    base_url: String,
    credential_handle: String,
) -> Result<Vec<String>, String> {
    let (endpoint, loopback) = provider_endpoint(&base_url, "models")?;
    let api_key = load_provider_credential(&credential_handle, loopback)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Could not configure provider client: {e}"))?;
    let mut request = client.get(endpoint);
    if let Some(key) = api_key.as_deref() { request = request.bearer_auth(key); }
    let mut response = request.send().await
        .map_err(|e| format!("Model catalog request failed: {e}"))?;
    let status = response.status();
    if response.content_length().map_or(false, |length| length > MAX_PROVIDER_RESPONSE_BYTES as u64) {
        return Err("Provider model catalog exceeded the 2 MB limit.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await
        .map_err(|e| format!("Could not read provider model catalog: {e}"))? {
        append_bounded_response(&mut body, &chunk)?;
    }
    if !status.is_success() {
        let raw = redact_provider_secret(&String::from_utf8_lossy(&body), api_key.as_deref());
        let excerpt: String = raw.chars().take(500).collect();
        return Err(format!("Provider returned HTTP {status}: {excerpt}"));
    }
    parse_provider_model_ids(&body)
}


const MAX_TRAINING_RECORD_BYTES: usize = 1_000_000;

fn bounded_json_text<'a>(value: &'a serde_json::Value, key: &str, max: usize) -> Result<&'a str, String> {
    let text = value.get(key).and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("Training record field '{key}' is required."))?;
    if text.trim().is_empty() || text.len() > max {
        return Err(format!("Training record field '{key}' is invalid."));
    }
    Ok(text)
}

fn unique_bounded_string_array(value: &serde_json::Value, key: &str, max_items: usize, max_len: usize) -> Result<Vec<String>, String> {
    let values = value.get(key).and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("Training record field '{key}' must be an array."))?;
    if values.len() > max_items {
        return Err(format!("Training record field '{key}' exceeds its item limit."));
    }
    let mut result = Vec::with_capacity(values.len());
    let mut seen = HashSet::new();
    for item in values {
        let text = item.as_str().ok_or_else(|| format!("Training record field '{key}' contains a non-string value."))?;
        if text.trim().is_empty() || text.len() > max_len || !seen.insert(text.to_string()) {
            return Err(format!("Training record field '{key}' contains invalid or duplicate values."));
        }
        result.push(text.to_string());
    }
    Ok(result)
}

fn validate_training_dataset_payload(value: &serde_json::Value) -> Result<(String, i64, i64), String> {
    if value.get("schemaVersion").and_then(serde_json::Value::as_i64) != Some(1) {
        return Err("Unsupported training dataset schema version.".into());
    }
    let id = bounded_json_text(value, "id", 160)?.to_string();
    let version = value.get("version").and_then(serde_json::Value::as_i64)
        .filter(|number| *number >= 1).ok_or_else(|| "Training dataset version is invalid.".to_string())?;
    bounded_json_text(value, "name", 160)?;
    bounded_json_text(value, "license", 300)?;
    bounded_json_text(value, "privacyClass", 40)?;
    let privacy = value["privacyClass"].as_str().unwrap_or_default();
    let consent = value.get("consentStatus").and_then(serde_json::Value::as_str).unwrap_or_default();
    if !["public", "synthetic", "owner_approved"].contains(&privacy)
        || !["approved", "not_required"].contains(&consent) {
        return Err("Training dataset privacy or consent status is not approved.".into());
    }
    if privacy == "owner_approved" {
        if consent != "approved" || value.get("approvalReference").and_then(serde_json::Value::as_str)
            .map_or(true, |reference| reference.trim().is_empty() || reference.len() > 300) {
            return Err("Owner-approved datasets require explicit approval provenance.".into());
        }
    }
    let sources = unique_bounded_string_array(value, "sourceReferences", 500, 500)?;
    if sources.is_empty() {
        return Err("Training dataset requires source provenance.".into());
    }
    let splits = value.get("splits").and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Training dataset splits are required.".to_string())?;
    let mut all_ids = HashSet::new();
    for split in ["train", "validation", "test"] {
        let values = splits.get(split).and_then(serde_json::Value::as_array)
            .ok_or_else(|| format!("Training dataset split '{split}' is required."))?;
        if values.len() > 100_000 {
            return Err("Training dataset split exceeds its item limit.".into());
        }
        if values.is_empty() {
            return Err(format!("Training dataset split '{split}' cannot be empty."));
        }
        let mut local = HashSet::new();
        for item in values {
            let sample_id = item.as_str().ok_or_else(|| "Training sample IDs must be strings.".to_string())?;
            if sample_id.trim().is_empty() || sample_id.len() > 160
                || !local.insert(sample_id.to_string()) || !all_ids.insert(sample_id.to_string()) {
                return Err("Training dataset splits must contain unique, disjoint sample IDs.".into());
            }
        }
    }
    let created_at = value.get("createdAt").and_then(serde_json::Value::as_i64)
        .filter(|timestamp| *timestamp > 0).ok_or_else(|| "Training dataset timestamp is invalid.".to_string())?;
    Ok((id, version, created_at))
}

fn contains_sensitive_training_key(value: &serde_json::Value, depth: usize) -> bool {
    if depth > 8 { return true; }
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, child)| {
            let key = key.to_ascii_lowercase();
            ["api_key", "apikey", "access_token", "password", "secret", "credential", "authorization", "prompt", "messages", "conversation", "raw_data", "sample_text"]
                .iter().any(|needle| key.contains(needle))
                || contains_sensitive_training_key(child, depth + 1)
        }),
        serde_json::Value::Array(items) => items.iter().any(|child| contains_sensitive_training_key(child, depth + 1)),
        _ => false,
    }
}

fn validate_training_experiment_payload(value: &serde_json::Value) -> Result<(String, String, i64, i64), String> {
    if value.get("schemaVersion").and_then(serde_json::Value::as_i64) != Some(1) {
        return Err("Unsupported training experiment schema version.".into());
    }
    let id = bounded_json_text(value, "id", 160)?.to_string();
    let dataset_id = bounded_json_text(value, "datasetManifestId", 160)?.to_string();
    let dataset_version = value.get("datasetManifestVersion").and_then(serde_json::Value::as_i64)
        .filter(|number| *number >= 1).ok_or_else(|| "Training experiment dataset version is invalid.".to_string())?;
    bounded_json_text(value, "name", 160)?;
    bounded_json_text(value, "modelId", 160)?;
    bounded_json_text(value, "codeRevision", 80)?;
    bounded_json_text(value, "hardware", 300)?;
    let method = bounded_json_text(value, "method", 40)?;
    if !["baseline", "prompting", "retrieval", "tooling", "lora"].contains(&method) {
        return Err("Training experiment method is invalid.".into());
    }
    let config = value.get("configuration").filter(|item| item.is_object())
        .ok_or_else(|| "Training experiment configuration must be an object.".to_string())?;
    if contains_sensitive_training_key(config, 0) {
        return Err("Training experiment configuration contains sensitive or raw prompt data.".into());
    }
    let metrics = value.get("metrics").and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Training experiment metrics must be an object.".to_string())?;
    if metrics.len() > 100 || metrics.iter().any(|(key, metric)| {
        key.trim().is_empty() || key.len() > 80 || !metric.is_number()
            || metric.as_f64().map_or(true, |number| !number.is_finite())
    }) {
        return Err("Training experiment metrics are invalid.".into());
    }
    let created_at = value.get("createdAt").and_then(serde_json::Value::as_i64)
        .filter(|timestamp| *timestamp > 0).ok_or_else(|| "Training experiment timestamp is invalid.".to_string())?;
    Ok((id, dataset_id, dataset_version, created_at))
}

fn save_training_dataset_record(connection: &Connection, manifest: &serde_json::Value) -> Result<(), String> {
    let (id, version, created_at) = validate_training_dataset_payload(manifest)?;
    let payload = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    if payload.len() > MAX_TRAINING_RECORD_BYTES {
        return Err("Training dataset manifest exceeds the 1 MB limit.".into());
    }
    let existing: Option<String> = connection.query_row(
        "SELECT payload FROM training_datasets WHERE id=?1 AND version=?2",
        params![id, version], |row| row.get(0)
    ).optional().map_err(|e| e.to_string())?;
    if let Some(existing) = existing {
        return if existing == payload { Ok(()) } else { Err("Dataset versions are immutable; create a new version instead.".into()) };
    }
    connection.execute(
        "INSERT INTO training_datasets(id,version,created_at,payload) VALUES(?1,?2,?3,?4)",
        params![id, version, created_at, payload]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn list_training_dataset_records(connection: &Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut statement = connection.prepare("SELECT payload FROM training_datasets ORDER BY created_at DESC,id,version DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|e| e.to_string())?;
        serde_json::from_str(&payload).map_err(|e| e.to_string())
    }).collect()
}

fn save_training_experiment_record(connection: &Connection, experiment: &serde_json::Value) -> Result<(), String> {
    let (id, dataset_id, dataset_version, created_at) = validate_training_experiment_payload(experiment)?;
    let payload = serde_json::to_string(experiment).map_err(|e| e.to_string())?;
    if payload.len() > MAX_TRAINING_RECORD_BYTES {
        return Err("Training experiment exceeds the 1 MB limit.".into());
    }
    let dataset_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM training_datasets WHERE id=?1 AND version=?2)",
        params![dataset_id, dataset_version], |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    if !dataset_exists {
        return Err("The referenced training dataset version has not been registered.".into());
    }
    let existing: Option<String> = connection.query_row(
        "SELECT payload FROM training_experiments WHERE id=?1",
        params![id], |row| row.get(0)
    ).optional().map_err(|e| e.to_string())?;
    if let Some(existing) = existing {
        return if existing == payload { Ok(()) } else { Err("Experiment IDs are immutable; create a new experiment instead.".into()) };
    }
    connection.execute(
        "INSERT INTO training_experiments(id,dataset_id,created_at,payload,dataset_version) VALUES(?1,?2,?3,?4,?5)",
        params![id, dataset_id, created_at, payload, dataset_version]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn list_training_experiment_records(connection: &Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut statement = connection.prepare("SELECT payload FROM training_experiments ORDER BY created_at DESC,id")
        .map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|e| e.to_string())?;
        serde_json::from_str(&payload).map_err(|e| e.to_string())
    }).collect()
}

#[tauri::command]
fn save_training_dataset(database: State<'_, AppDatabase>, manifest: serde_json::Value) -> Result<(), String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    save_training_dataset_record(&connection, &manifest)
}

#[tauri::command]
fn list_training_datasets(database: State<'_, AppDatabase>) -> Result<Vec<serde_json::Value>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    list_training_dataset_records(&connection)
}

#[tauri::command]
fn save_training_experiment(database: State<'_, AppDatabase>, experiment: serde_json::Value) -> Result<(), String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    save_training_experiment_record(&connection, &experiment)
}

#[tauri::command]
fn list_training_experiments(database: State<'_, AppDatabase>) -> Result<Vec<serde_json::Value>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    list_training_experiment_records(&connection)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut connection = Connection::open(data_dir.join("nexus-au.sqlite"))?;
            connection.execute_batch("PRAGMA foreign_keys = ON;")?;
            migrate_database(&mut connection)?;
            app.manage(AppDatabase(Mutex::new(connection)));
            app.manage(ActiveChatStreams::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_app_version, send_chat, send_chat_stream, cancel_chat_stream, list_provider_models, save_training_dataset, list_training_datasets, save_training_experiment, list_training_experiments, load_conversations, save_conversations, load_projects, save_project, delete_project, load_memories, save_memory, delete_memory, load_knowledge_chunks, save_knowledge_chunks, replace_knowledge_document, delete_knowledge_document, export_workspace, import_workspace, store_provider_key, provider_vault_status, has_provider_key, delete_provider_key, load_agent_checkpoint, list_agent_checkpoints, save_agent_checkpoint, delete_agent_checkpoint, record_tool_audit_event, list_tool_audit_events, append_trace_event, list_trace_events, write_clipboard, read_clipboard])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS AU");
}
#[cfg(test)]
mod database_tests {
    use super::*;
    #[test]
    fn training_dataset_manifest_requires_provenance_and_disjoint_splits() {
        let valid = serde_json::json!({
            "schemaVersion":1,"id":"dataset-1","version":1,"name":"Synthetic baseline",
            "license":"CC0-1.0","privacyClass":"synthetic","consentStatus":"not_required",
            "sourceReferences":["generated:baseline"],"createdAt":100,
            "splits":{"train":["a"],"validation":["b"],"test":["c"]}
        });
        assert!(validate_training_dataset_payload(&valid).is_ok());
        let mut overlap = valid.clone();
        overlap["splits"]["test"] = serde_json::json!(["a"]);
        assert!(validate_training_dataset_payload(&overlap).is_err());
        let mut private = valid.clone();
        private["privacyClass"] = serde_json::json!("owner_approved");
        private["consentStatus"] = serde_json::json!("pending");
        assert!(validate_training_dataset_payload(&private).is_err());
    }

    #[test]
    fn training_lab_records_are_persisted_immutably_with_exact_dataset_versions() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("create current schema");
        let dataset_v1 = serde_json::json!({
            "schemaVersion":1,"id":"dataset-1","version":1,"name":"Synthetic",
            "license":"CC0-1.0","privacyClass":"synthetic","consentStatus":"not_required",
            "sourceReferences":["generated:test"],"createdAt":100,
            "splits":{"train":["a"],"validation":["b"],"test":["c"]}
        });
        save_training_dataset_record(&connection, &dataset_v1).expect("save dataset v1");
        save_training_dataset_record(&connection, &dataset_v1).expect("idempotent save");
        let mut conflicting = dataset_v1.clone();
        conflicting["name"] = serde_json::json!("Changed");
        assert!(save_training_dataset_record(&connection, &conflicting).is_err());

        let mut dataset_v2 = dataset_v1.clone();
        dataset_v2["version"] = serde_json::json!(2);
        save_training_dataset_record(&connection, &dataset_v2).expect("save dataset v2");

        let experiment = serde_json::json!({
            "schemaVersion":1,"id":"experiment-1","name":"Baseline","modelId":"gateway/model",
            "method":"baseline","datasetManifestId":"dataset-1","datasetManifestVersion":1,
            "codeRevision":"abc1234","hardware":"CI runner","configuration":{"temperature":0},
            "metrics":{"passRate":0.5},"createdAt":200
        });
        save_training_experiment_record(&connection, &experiment).expect("save experiment");
        let mut wrong_version = experiment.clone();
        wrong_version["datasetManifestVersion"] = serde_json::json!(3);
        wrong_version["id"] = serde_json::json!("experiment-2");
        assert!(save_training_experiment_record(&connection, &wrong_version).is_err());
        assert_eq!(list_training_dataset_records(&connection).expect("list datasets").len(), 2);
        assert_eq!(list_training_experiment_records(&connection).expect("list experiments").len(), 1);
    }

    #[test]
    fn training_experiment_rejects_secret_bearing_configuration() {
        let valid = serde_json::json!({
            "schemaVersion":1,"id":"experiment-1","name":"Baseline","modelId":"gateway/model",
            "method":"baseline","datasetManifestId":"dataset-1","datasetManifestVersion":1,"codeRevision":"abc1234",
            "hardware":"CI runner","configuration":{"temperature":0.0},
            "metrics":{"passRate":0.5},"createdAt":100
        });
        assert!(validate_training_experiment_payload(&valid).is_ok());
        let mut unsafe_record = valid.clone();
        unsafe_record["configuration"] = serde_json::json!({"nested":{"apiKey":"do-not-store"}});
        assert!(validate_training_experiment_payload(&unsafe_record).is_err());
    }

    #[test]
    fn provider_endpoint_normalizes_paths_and_enforces_transport_security() {
        let (cloud, cloud_loopback) = provider_endpoint("https://api.example.test/v1", "chat/completions").unwrap();
        assert_eq!(cloud.as_str(), "https://api.example.test/v1/chat/completions");
        assert!(!cloud_loopback);

        let (local, local_loopback) = provider_endpoint("http://127.0.0.1:11434/v1/", "models").unwrap();
        assert_eq!(local.as_str(), "http://127.0.0.1:11434/v1/models");
        assert!(local_loopback);

        let (already_normalized, _) = provider_endpoint("https://api.example.test/v1/models", "models").unwrap();
        assert_eq!(already_normalized.as_str(), "https://api.example.test/v1/models");
    }

    #[test]
    fn provider_endpoint_rejects_insecure_or_ambiguous_urls() {
        assert!(provider_endpoint("http://api.example.test/v1", "models").is_err());
        assert!(provider_endpoint("https://user:pass@api.example.test/v1", "models").is_err());
        assert!(provider_endpoint("https://api.example.test/v1?token=secret", "models").is_err());
        assert!(provider_endpoint("https://api.example.test/v1#fragment", "models").is_err());
        assert!(provider_endpoint("ftp://127.0.0.1/v1", "models").is_err());
        assert!(provider_endpoint("https://api.example.test/v1", "admin").is_err());
    }

    #[test]
    fn stream_ids_are_bounded_and_safe() {
        assert!(valid_stream_id("stream-123_ABC"));
        assert!(!valid_stream_id(""));
        assert!(!valid_stream_id("bad/id"));
        assert!(!valid_stream_id("bad id"));
        assert!(!valid_stream_id(&"x".repeat(129)));
    }

    #[test]
    fn provider_model_catalog_filters_invalid_and_duplicate_ids() {
        let body = br#"{"data":[{"id":"auto"},{"id":"provider/model-a"},{"id":"provider/model-a"},{"id":""},{"name":"missing-id"},{"id":"bad\nmodel"}]}"#;
        let ids = parse_provider_model_ids(body).expect("valid catalog");
        assert_eq!(ids, vec!["auto".to_string(), "provider/model-a".to_string()]);
    }

    #[test]
    fn provider_model_catalog_rejects_empty_or_invalid_catalogs() {
        assert!(parse_provider_model_ids(br#"{"data":[]}"#).is_err());
        assert!(parse_provider_model_ids(br#"{"models":[]}"#).is_err());
        assert!(parse_provider_model_ids(b"not-json").is_err());
    }

    fn checkpoint(sequence: i64, status: &str) -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "runId": "run-1",
            "agentId": "agent-1",
            "threadId": "thread-1",
            "sequence": sequence,
            "status": status,
            "state": {"payload": {"task": "persist me"}},
            "createdAt": 1000,
            "updatedAt": 1000 + sequence,
            "pendingApproval": if status == "waiting_for_approval" {
                Some(serde_json::json!({"permission":"tool:execute","requestedAt":1000 + sequence}))
            } else { None }
        })
    }


    fn sample_backup() -> serde_json::Value {
        serde_json::json!({
            "format": "nexus-au-backup",
            "schemaVersion": 1,
            "exportedAt": 123,
            "projects": [{
                "id": "project-1", "name": "Project", "description": "Test",
                "createdAt": 1, "updatedAt": 2, "archived": false, "schemaVersion": 1
            }],
            "conversations": [{
                "id": "conversation-1", "title": "Chat", "projectId": "project-1",
                "updatedAt": 3,
                "messages": [{"id": "message-1", "role": "user", "content": "Hello", "createdAt": 3}]
            }],
            "memories": [{
                "id": "memory-1", "content": "A saved fact", "category": "fact",
                "scope": "project", "projectId": "project-1",
                "source": {"type": "user_confirmed", "label": "Manual"},
                "tags": ["test"], "createdAt": 1, "updatedAt": 2, "schemaVersion": 1
            }],
            "knowledgeChunks": [{
                "id": "chunk-1", "documentId": "document-1", "projectId": "project-1",
                "text": "A source passage", "sourceLabel": "notes.md"
            }]
        })
    }



    #[test]
    fn knowledge_document_replacement_is_transactional_and_scoped() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("apply migrations");
        connection.execute("INSERT INTO projects(id,name,description,created_at,updated_at,archived,schema_version) VALUES('p1','Project','',1,1,0,1)",[]).expect("create project");
        let old=serde_json::json!({"id":"doc:old","documentId":"doc","projectId":"p1","text":"old passage","sourceLabel":"notes.md"});
        connection.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4)",params!["doc:old","doc","p1",old.to_string()]).expect("seed old chunk");
        let next=serde_json::json!({"id":"doc:new","documentId":"doc","projectId":"p1","text":"new passage","sourceLabel":"notes.md"});
        replace_knowledge_document_record(&mut connection,"doc".into(),"p1".into(),vec![next.clone()]).expect("replace document");
        let stored:String=connection.query_row("SELECT payload FROM knowledge_chunks WHERE id='doc:new'",[],|r|r.get(0)).expect("load replacement");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&stored).unwrap(),next);
        let old_count:i64=connection.query_row("SELECT COUNT(*) FROM knowledge_chunks WHERE id='doc:old'",[],|r|r.get(0)).expect("old chunk count");
        assert_eq!(old_count,0);

        let collision=serde_json::json!({"id":"collision","documentId":"other","projectId":"p1","text":"other document","sourceLabel":"other.md"});
        connection.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4)",params!["collision","other","p1",collision.to_string()]).expect("seed collision");
        let conflicting=serde_json::json!({"id":"collision","documentId":"doc","projectId":"p1","text":"replacement conflict","sourceLabel":"notes.md"});
        assert!(replace_knowledge_document_record(&mut connection,"doc".into(),"p1".into(),vec![conflicting]).is_err());
        let retained:String=connection.query_row("SELECT payload FROM knowledge_chunks WHERE id='doc:new'",[],|r|r.get(0)).expect("old replacement must survive rollback");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&retained).unwrap(),next);
        delete_knowledge_document_record(&connection,"doc".into(),"p1".into()).expect("delete selected document");
        let remaining:i64=connection.query_row("SELECT COUNT(*) FROM knowledge_chunks WHERE project_id='p1' AND document_id='doc'",[],|r|r.get(0)).expect("deleted document count");
        assert_eq!(remaining,0);
        let other_count:i64=connection.query_row("SELECT COUNT(*) FROM knowledge_chunks WHERE id='collision'",[],|r|r.get(0)).expect("other document remains");
        assert_eq!(other_count,1);
    }

    #[test]
    fn native_audit_and_trace_events_round_trip_with_filtering_and_redaction() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        let audit=serde_json::json!({"toolId":"notes.search","runId":"run-1","traceId":"trace-1","status":"completed","timestamp":12.0,"detail":"done"});
        record_tool_audit_event_record(&mut connection,audit.clone()).expect("record audit");
        assert_eq!(list_tool_audit_event_records(&connection,Some("run-1"),10).expect("list audit"),vec![audit]);
        let trace=serde_json::json!({
            "traceId":"trace-1","runId":"run-1","parentTraceId":"parent-1",
            "name":"agent.step","status":"completed","timestamp":13.0,"durationMs":5.0,
            "attributes":{"step":2,"apiKey":"must-not-persist","label":"safe"},
            "apiKey":"must-not-persist","prompt":"must-not-persist",
            "unexpected":{"secret":"must-not-persist"}
        });
        append_trace_event_record(&mut connection,trace).expect("append trace");
        let listed=list_trace_event_records(&connection,Some("run-1"),Some("trace-1"),10).expect("list trace");
        assert_eq!(listed.len(),1);
        assert_eq!(listed[0]["attributes"]["step"],2);
        assert_eq!(listed[0]["attributes"]["label"],"safe");
        assert!(listed[0]["attributes"].get("apiKey").is_none());
        assert_eq!(listed[0]["parentTraceId"],"parent-1");
        assert_eq!(listed[0]["durationMs"],5.0);
        assert!(listed[0].get("apiKey").is_none());
        assert!(listed[0].get("prompt").is_none());
        assert!(listed[0].get("unexpected").is_none());
    }

    #[test]
    fn audit_listing_omits_absent_optional_detail_fields() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        record_tool_audit_event_record(&mut connection,serde_json::json!({"toolId":"tool","runId":"run","traceId":"trace","status":"started","timestamp":1})).expect("record audit");
        let listed=list_tool_audit_event_records(&connection,None,10).expect("list audit");
        assert_eq!(listed.len(),1);
        assert!(listed[0].get("detail").is_none());
    }

    #[test]
    fn native_audit_and_trace_storage_reject_invalid_events() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        assert!(record_tool_audit_event_record(&mut connection,serde_json::json!({"toolId":"x","runId":"r","traceId":"t","status":"unknown","timestamp":1})).is_err());
        assert!(append_trace_event_record(&mut connection,serde_json::json!({"traceId":"t","runId":"r","name":"event","status":"unknown","timestamp":1})).is_err());
        assert!(list_trace_event_records(&connection,None,None,0).is_err());
    }

    #[test]
    fn workspace_backup_import_export_round_trip_preserves_all_user_data() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("apply migrations");
        import_workspace_record(&mut connection, sample_backup()).expect("import backup");
        let exported = export_workspace_record(&connection).expect("export backup");
        assert_eq!(exported["format"], "nexus-au-backup");
        assert_eq!(exported["schemaVersion"], 1);
        assert_eq!(exported["projects"][0]["id"], "project-1");
        assert_eq!(exported["conversations"][0]["messages"][0]["content"], "Hello");
        assert_eq!(exported["memories"][0]["content"], "A saved fact");
        assert_eq!(exported["knowledgeChunks"][0]["text"], "A source passage");
        assert!(exported.get("providerKeys").is_none(), "provider credentials must never be exported");
    }

    #[test]
    fn invalid_backup_and_transaction_failure_leave_existing_workspace_untouched() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("apply migrations");
        import_workspace_record(&mut connection, sample_backup()).expect("seed workspace");
        let before = export_workspace_record(&connection).expect("export baseline");

        let mut invalid = sample_backup();
        invalid["knowledgeChunks"][0]["projectId"] = serde_json::json!("unknown-project");
        assert!(import_workspace_record(&mut connection, invalid).is_err());
        let after_validation_failure = export_workspace_record(&connection).expect("export after validation failure");
        assert_eq!(before["projects"], after_validation_failure["projects"]);
        assert_eq!(before["conversations"], after_validation_failure["conversations"]);

        // Duplicate message primary keys pass the shape checks but fail during
        // insertion after the transaction has already deleted the old rows.
        let mut duplicate = sample_backup();
        duplicate["conversations"].as_array_mut().unwrap().push(serde_json::json!({
            "id": "conversation-2", "title": "Second", "projectId": "project-1",
            "updatedAt": 4,
            "messages": [{"id": "message-1", "role": "user", "content": "duplicate", "createdAt": 4}]
        }));
        assert!(import_workspace_record(&mut connection, duplicate).is_err());
        let after_rollback = export_workspace_record(&connection).expect("export after rollback");
        assert_eq!(before["projects"], after_rollback["projects"]);
        assert_eq!(before["conversations"], after_rollback["conversations"]);
        assert_eq!(before["memories"], after_rollback["memories"]);
        assert_eq!(before["knowledgeChunks"], after_rollback["knowledgeChunks"]);
    }

    #[test]
    fn upgrades_schema_version_four_atomically_to_eight() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("create current schema");
        connection.pragma_update(None, "user_version", 4).expect("simulate v4");
        connection.execute_batch("DROP TABLE trace_events; DROP TABLE tool_audit_events; DROP TABLE agent_checkpoints; DROP TABLE training_experiments; DROP TABLE training_datasets;").expect("remove v5 and v6 tables");
        migrate_database(&mut connection).expect("upgrade v4 to v8");
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).expect("schema version");
        assert_eq!(version, 8);
        let table: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='agent_checkpoints'", [], |row| row.get(0)).expect("checkpoint table");
        assert_eq!(table, 1);
        let audit: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tool_audit_events'", [], |row| row.get(0)).expect("audit table");
        assert_eq!(audit, 1);
    }

    #[test]
    fn native_agent_checkpoints_round_trip_and_enforce_compare_and_swap() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");

        let first = checkpoint(1, "running");
        save_agent_checkpoint_record(&mut connection, first.clone(), None).expect("save initial checkpoint");
        assert_eq!(load_agent_checkpoint_record(&connection, "run-1").expect("load checkpoint"), Some(first));

        let waiting = checkpoint(2, "waiting_for_approval");
        save_agent_checkpoint_record(&mut connection, waiting.clone(), Some(1)).expect("advance checkpoint");
        assert_eq!(list_agent_checkpoint_records(&connection, "thread-1", 10).expect("list checkpoints"), vec![waiting.clone()]);

        let stale = checkpoint(2, "waiting_for_approval");
        assert!(save_agent_checkpoint_record(&mut connection, stale, Some(1)).is_err(), "stale sequence must not overwrite the current record");

        let completed = checkpoint(3, "completed");
        save_agent_checkpoint_record(&mut connection, completed, Some(2)).expect("complete checkpoint");
        assert!(save_agent_checkpoint_record(&mut connection, checkpoint(4, "running"), Some(3)).is_err(), "terminal checkpoints must be immutable");

        delete_agent_checkpoint_record(&connection, "run-1").expect("delete checkpoint");
        assert_eq!(load_agent_checkpoint_record(&connection, "run-1").expect("load deleted checkpoint"), None);
    }

    #[test]
    fn native_agent_checkpoints_reject_invalid_and_oversized_payloads() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        let mut invalid = checkpoint(1, "running");
        invalid["threadId"] = serde_json::json!(" ");
        assert!(save_agent_checkpoint_record(&mut connection, invalid, None).is_err());

        let mut oversized = checkpoint(1, "running");
        oversized["state"] = serde_json::json!({"payload": "x".repeat(MAX_AGENT_CHECKPOINT_BYTES + 1)});
        assert!(save_agent_checkpoint_record(&mut connection, oversized, None).is_err());
    }

    #[test]
    fn provider_response_limit_is_enforced_incrementally() {
        let mut body = Vec::new();
        append_bounded_response(&mut body, &vec![0; MAX_PROVIDER_RESPONSE_BYTES]).expect("exact limit is accepted");
        assert_eq!(body.len(), MAX_PROVIDER_RESPONSE_BYTES);
        assert!(append_bounded_response(&mut body, &[1]).is_err(), "one byte over the limit must be rejected");
    }

    #[test]
    fn creates_versioned_schema_and_foreign_key_constraints() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("apply initial migration");
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).expect("schema version");
        assert_eq!(version, 8);
        let project_table: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'", [], |row| row.get(0)).expect("projects table");
        assert_eq!(project_table, 1);
        let result = connection.execute("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES('m1','missing','user','test',1)", []);
        assert!(result.is_err(), "message must reference an existing conversation");
        let invalid_project = connection.execute("INSERT INTO conversations(id,title,project_id,updated_at) VALUES('c0','invalid','missing',1)", []);
        assert!(invalid_project.is_err(), "conversation must reference an existing project");
        connection.execute("INSERT INTO projects(id,name,description,created_at,updated_at,archived,schema_version) VALUES('p1','Project','',1,1,0,1)", []).expect("create project");
        connection.execute("INSERT INTO conversations(id,title,project_id,updated_at) VALUES('c1','valid','p1',1)", []).expect("create project conversation");
        connection.execute("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES('m2','c1','user','test',1)", []).expect("create message");
        connection.execute("INSERT INTO memory_records(id,scope,project_id,updated_at,payload) VALUES('mem1','project','p1',1,'{}')", []).expect("create project memory");
        connection.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES('k1','d1','p1','{}')", []).expect("create project knowledge");
        connection.execute("DELETE FROM projects WHERE id='p1'", []).expect("delete project");
        let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM conversations WHERE project_id='p1'", [], |r| r.get(0)).expect("conversation cleanup");
        assert_eq!(remaining, 0);
        let memories: i64 = connection.query_row("SELECT COUNT(*) FROM memory_records WHERE project_id='p1'", [], |r| r.get(0)).expect("memory cleanup");
        assert_eq!(memories, 0);
        let chunks: i64 = connection.query_row("SELECT COUNT(*) FROM knowledge_chunks WHERE project_id='p1'", [], |r| r.get(0)).expect("knowledge cleanup");
        assert_eq!(chunks, 0);
    }
}
