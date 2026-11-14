mod workspace_fs;
mod workspace_fs_search;
mod workspace_fs_ops;
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

fn valid_provider_model_id(model: &str) -> bool {
    !model.trim().is_empty()
        && model.len() <= 128
        && !model.chars().any(char::is_control)
}

fn validate_generation_parameters(temperature: Option<f32>, max_output_tokens: Option<u32>) -> Result<(), String> {
    if temperature.map_or(false, |value| !value.is_finite() || !(0.0..=2.0).contains(&value)) {
        return Err("Temperature must be a finite number between 0 and 2.".into());
    }
    if max_output_tokens.map_or(false, |value| value == 0 || value > 1_000_000) {
        return Err("Maximum output tokens must be an integer between 1 and 1,000,000.".into());
    }
    Ok(())
}
fn append_bounded_response(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if body.len().saturating_add(chunk.len()) > MAX_PROVIDER_RESPONSE_BYTES {
        return Err("Provider response exceeded the 2 MB limit.".into());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

struct AppDatabase(Mutex<Connection>);

type ActiveStreamMap = HashMap<String, Arc<AtomicBool>>;
const MAX_PENDING_STREAM_CANCELLATIONS: usize = 128;

#[derive(Default)]
struct ActiveStreamState {
    active: ActiveStreamMap,
    pending_cancellations: HashSet<String>,
}

#[derive(Clone, Default)]
struct ActiveChatStreams(Arc<Mutex<ActiveStreamState>>);

struct ActiveStreamGuard {
    streams: Arc<Mutex<ActiveStreamState>>,
    stream_id: String,
}
impl Drop for ActiveStreamGuard {
    fn drop(&mut self) {
        if let Ok(mut streams) = self.streams.lock() {
            streams.active.remove(&self.stream_id);
            streams.pending_cancellations.remove(&self.stream_id);
        }
    }
}

fn valid_stream_id(stream_id: &str) -> bool {
    !stream_id.is_empty()
        && stream_id.len() <= 128
        && stream_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn register_active_stream(state: &mut ActiveStreamState, stream_id: &str, cancelled: Arc<AtomicBool>) -> Result<(), String> {
    if state.active.contains_key(stream_id) {
        return Err("A chat stream with this ID is already active.".into());
    }
    if state.pending_cancellations.remove(stream_id) {
        cancelled.store(true, Ordering::Release);
    }
    state.active.insert(stream_id.to_string(), cancelled);
    Ok(())
}

fn request_stream_cancellation(state: &mut ActiveStreamState, stream_id: &str) -> bool {
    if let Some(cancelled) = state.active.get(stream_id) {
        cancelled.store(true, Ordering::Release);
        return true;
    }
    if state.pending_cancellations.len() >= MAX_PENDING_STREAM_CANCELLATIONS {
        if let Some(oldest) = state.pending_cancellations.iter().next().cloned() {
            state.pending_cancellations.remove(&oldest);
        }
    }
    state.pending_cancellations.insert(stream_id.to_string());
    true
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
    let mut state = streams.0.lock().map_err(|_| "Stream registry is unavailable.")?;
    Ok(request_stream_cancellation(&mut state, &stream_id))
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
    if version < 9 {
        transaction.execute_batch("CREATE TABLE tool_audit_events_v9 (id INTEGER PRIMARY KEY AUTOINCREMENT,tool_id TEXT NOT NULL,run_id TEXT NOT NULL,trace_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('started','completed','failed','denied','reconciled')),timestamp REAL NOT NULL,detail TEXT); INSERT INTO tool_audit_events_v9(tool_id,run_id,trace_id,status,timestamp,detail) SELECT tool_id,run_id,trace_id,status,timestamp,detail FROM tool_audit_events ORDER BY id; DROP TABLE tool_audit_events; ALTER TABLE tool_audit_events_v9 RENAME TO tool_audit_events; CREATE INDEX idx_tool_audit_run_id ON tool_audit_events(run_id,id DESC);")?;
        version = 9;
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

fn valid_credential_handle(handle: &str) -> bool {
    if matches!(handle, "default" | "ollama") {
        return true;
    }
    let Some(profile_id) = handle.strip_prefix("profile-") else {
        return false;
    };
    profile_id.len() == 32 && profile_id.bytes().all(|byte| {
        byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
    })
}

fn credential_entry(handle: &str) -> Result<keyring::Entry, String> {
    if !valid_credential_handle(handle) { return Err("Unknown provider credential profile.".into()); }
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

struct ProviderSecretRedactor {
    secret: Option<String>,
    pending: String,
}

impl ProviderSecretRedactor {
    fn new(api_key: Option<&str>) -> Self {
        Self {
            secret: api_key.filter(|key| !key.is_empty()).map(str::to_owned),
            pending: String::new(),
        }
    }

    /// Redact across provider delta boundaries while retaining only the suffix
    /// that could still become the beginning of a split credential.
    fn push(&mut self, text: &str) -> String {
        let Some(secret) = self.secret.as_deref() else {
            return text.to_string();
        };
        self.pending.push_str(text);
        let redacted = self.pending.replace(secret, "[redacted]");
        let keep = secret.chars().count().saturating_sub(1);
        let emit = redacted.chars().count().saturating_sub(keep);
        let split = redacted.char_indices().nth(emit)
            .map(|(index, _)| index)
            .unwrap_or(redacted.len());
        let output = redacted[..split].to_string();
        self.pending = redacted[split..].to_string();
        output
    }

    fn finish(&mut self) -> String {
        let output = match self.secret.as_deref() {
            Some(secret) => self.pending.replace(secret, "[redacted]"),
            None => self.pending.clone(),
        };
        self.pending.clear();
        output
    }
}

fn redact_provider_secret(message: &str, api_key: Option<&str>) -> String {
    match api_key.filter(|key| !key.is_empty()) {
        Some(key) => message.replace(key, "[redacted]"),
        None => message.to_string()
    }
}

fn validate_provider_key(api_key: &str) -> Result<&str, &'static str> {
    let normalized = api_key.trim();
    if normalized.is_empty() { return Err("API key cannot be empty."); }
    if normalized.len() > 8192 { return Err("API key exceeds the 8 KB limit."); }
    if normalized.chars().any(char::is_control) { return Err("API key contains unsupported control characters."); }
    Ok(normalized)
}

#[tauri::command]
fn store_provider_key(api_key: String, credential_handle: String) -> Result<(), String> {
    let normalized = validate_provider_key(&api_key).map_err(str::to_owned)?;
    credential_entry(&credential_handle)?.set_password(normalized).map_err(|e| format!("Could not store API key in the OS credential vault: {e}"))
}

fn classify_provider_vault_status(entry_available: bool, credential_present: Option<bool>) -> &'static str {
    if !entry_available { return "unavailable"; }
    match credential_present {
        Some(true) => "available",
        Some(false) => "missing",
        None => "unavailable"
    }
}

fn provider_vault_status_for(handle: &str) -> &'static str {
    match credential_entry(handle) {
        Ok(entry) => match entry.get_password() {
            Ok(secret) => classify_provider_vault_status(true, Some(!secret.is_empty())),
            Err(keyring::Error::NoEntry) => classify_provider_vault_status(true, Some(false)),
            Err(_) => classify_provider_vault_status(true, None)
        },
        Err(_) => classify_provider_vault_status(false, None)
    }
}

#[tauri::command]
fn provider_vault_status(credential_handle: String) -> &'static str {
    provider_vault_status_for(&credential_handle)
}

#[tauri::command]
fn has_provider_key() -> bool {
    provider_vault_status_for("default") == "available"
}

#[tauri::command]
fn delete_provider_key(credential_handle: String) -> Result<(), String> {
    match credential_entry(&credential_handle)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete API key from the OS credential vault: {e}"))
    }
}

#[cfg(test)]
mod payload_validation_tests {
    use super::*;
    #[test]
    fn stream_cancellation_is_not_lost_when_requested_before_registration() {
        let mut state = ActiveStreamState::default();
        assert!(request_stream_cancellation(&mut state, "stream-early"));
        let cancelled = Arc::new(AtomicBool::new(false));
        register_active_stream(&mut state, "stream-early", cancelled.clone()).expect("register cancelled stream");
        assert!(cancelled.load(Ordering::Acquire));
        assert!(state.pending_cancellations.is_empty());
        assert!(state.active.contains_key("stream-early"));
    }

    #[test]
    fn active_stream_cancellation_marks_the_registered_token() {
        let mut state = ActiveStreamState::default();
        let cancelled = Arc::new(AtomicBool::new(false));
        register_active_stream(&mut state, "stream-active", cancelled.clone()).expect("register stream");
        assert!(request_stream_cancellation(&mut state, "stream-active"));
        assert!(cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn pending_stream_cancellations_are_bounded() {
        let mut state = ActiveStreamState::default();
        for index in 0..(MAX_PENDING_STREAM_CANCELLATIONS + 10) {
            request_stream_cancellation(&mut state, &format!("stream-{index}"));
        }
        assert_eq!(state.pending_cancellations.len(), MAX_PENDING_STREAM_CANCELLATIONS);
    }

    #[test]
    fn provider_credentials_use_separate_allowlisted_vault_profiles() {
        assert!(valid_credential_handle("default"));
        assert!(valid_credential_handle("ollama"));
        assert!(valid_credential_handle("profile-0123456789abcdef0123456789abcdef"));
        assert!(!valid_credential_handle("none"));
        assert!(!valid_credential_handle("unknown"));
        assert!(!valid_credential_handle("profile-../../etc/passwd"));
        assert!(!valid_credential_handle("profile-0123456789ABCDEF0123456789ABCDEF"));
        assert!(!valid_credential_handle("profile-0123456789abcdef"));
    }

    #[test]
    fn provider_secret_redaction_covers_non_streaming_model_output() {
        assert_eq!(
            redact_provider_secret("The provider echoed sk-private-token in its answer.", Some("sk-private-token")),
            "The provider echoed [redacted] in its answer."
        );
    }

    #[test]
    fn unauthenticated_provider_credentials_are_limited_to_loopback() {
        assert_eq!(load_provider_credential("none", true).unwrap(), None);
        assert!(load_provider_credential("none", false).is_err());
        assert_eq!(redact_provider_secret("provider error", None), "provider error");
    }

    #[test]
    fn native_provider_model_ids_reject_empty_oversized_and_control_values() {
        assert!(valid_provider_model_id("auto"));
        assert!(valid_provider_model_id("qwen2.5:7b"));
        assert!(!valid_provider_model_id("  "));
        assert!(!valid_provider_model_id(&"x".repeat(129)));
        assert!(!valid_provider_model_id("bad\nmodel"));
    }

    #[test]
    fn generation_controls_are_validated_at_the_native_boundary() {
        assert!(validate_generation_parameters(None, None).is_ok());
        assert!(validate_generation_parameters(Some(0.0), Some(1)).is_ok());
        assert!(validate_generation_parameters(Some(2.0), Some(1_000_000)).is_ok());
        assert!(validate_generation_parameters(Some(f32::NAN), None).is_err());
        assert!(validate_generation_parameters(Some(f32::INFINITY), None).is_err());
        assert!(validate_generation_parameters(Some(-0.1), None).is_err());
        assert!(validate_generation_parameters(Some(2.1), None).is_err());
        assert!(validate_generation_parameters(None, Some(0)).is_err());
        assert!(validate_generation_parameters(None, Some(1_000_001)).is_err());
    }

    #[test]
    fn provider_secret_redactor_masks_credentials_split_across_stream_chunks() {
        let mut redactor = ProviderSecretRedactor::new(Some("super-secret-key"));
        let output = [
            redactor.push("Provider echoed: super-"),
            redactor.push("secret-"),
            redactor.push("key; continue safely."),
            redactor.finish(),
        ].concat();
        assert_eq!(output, "Provider echoed: [redacted]; continue safely.");
        assert!(!output.contains("super-secret-key"));
    }

    #[test]
    fn provider_secret_redactor_preserves_normal_text_and_handles_no_key_mode() {
        let mut with_key = ProviderSecretRedactor::new(Some("token"));
        assert_eq!(with_key.push("ordinary output"), "ordinary ou");
        assert_eq!(with_key.finish(), "tput");
        let mut without_key = ProviderSecretRedactor::new(None);
        assert_eq!(without_key.push("streamed text"), "streamed text");
        assert_eq!(without_key.finish(), "");
    }

    #[test]
    fn sse_eof_requires_an_explicit_finish_reason() {
        assert_eq!(completion_reason_for_eof(Some("stop")).unwrap(), "stop");
        assert_eq!(completion_reason_for_eof(Some("length")).unwrap(), "length");
        assert!(completion_reason_for_eof(None).is_err());
        assert!(completion_reason_for_eof(Some("  ")).is_err());
    }

    #[test]
    fn sse_parser_extracts_text_and_handles_done() {
        let event = r#"{"choices":[{"delta":{"content":"hello"}}]}"#;
        assert_eq!(parse_sse_chunk(event).unwrap().unwrap().text.as_deref(), Some("hello"));
        assert_eq!(parse_sse_chunk("[DONE]").unwrap(), None);
    }

    #[test]
    fn sse_parser_handles_empty_role_and_rejects_invalid_payload() {
        let event = r#"{"choices":[{"delta":{"role":"assistant"}}]}"#;
        assert_eq!(parse_sse_chunk(event).unwrap().unwrap().text, None);
        assert!(parse_sse_chunk("not-json").is_err());
        assert!(parse_sse_chunk(r#"{"error":{"message":"bad request"}}"#).is_err());
    }

    #[test]
    fn sse_parser_extracts_finish_reason_and_usage_metadata() {
        let event = r#"{"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":23,"completion_tokens":7}}"#;
        let parsed = parse_sse_chunk(event).unwrap().unwrap();
        assert_eq!(parsed.finish_reason.as_deref(), Some("length"));
        assert_eq!(parsed.input_tokens, Some(23));
        assert_eq!(parsed.output_tokens, Some(7));
    }

    #[test]
    fn sse_parser_accepts_alternate_usage_token_names() {
        let event = r#"{"choices":[],"usage":{"input_tokens":11,"output_tokens":4}}"#;
        let parsed = parse_sse_chunk(event).unwrap().unwrap();
        assert_eq!(parsed.input_tokens, Some(11));
        assert_eq!(parsed.output_tokens, Some(4));
    }

    #[test]
    fn provider_key_validation_rejects_empty_oversized_and_control_values() {
        assert_eq!(validate_provider_key("  key-value  "), Ok("key-value"));
        assert!(validate_provider_key("  ").is_err());
        assert!(validate_provider_key(&"x".repeat(8193)).is_err());
        assert!(validate_provider_key("key\nvalue").is_err());
    }

    #[test]
    fn credential_vault_status_distinguishes_missing_and_unavailable() {
        assert_eq!(classify_provider_vault_status(false,None),"unavailable");
        assert_eq!(classify_provider_vault_status(true,None),"unavailable");
        assert_eq!(classify_provider_vault_status(true,Some(false)),"missing");
        assert_eq!(classify_provider_vault_status(true,Some(true)),"available");
    }

    #[test]
    fn rejects_invalid_memory_and_knowledge_payloads() {
        let memory=serde_json::json!({"id":"m1","content":"A saved fact","category":"fact","scope":"profile","source":{"type":"user_confirmed","label":"Manual"},"tags":["test"],"createdAt":1,"updatedAt":1,"schemaVersion":1});
        assert!(valid_memory_record(&memory));
        let mut invalid_memory=memory.clone();
        invalid_memory["source"]["label"]=serde_json::json!("");
        assert!(!valid_memory_record(&invalid_memory));
        let chunk=serde_json::json!({"id":"k1","documentId":"d1","projectId":"p1","text":"A source passage","sourceLabel":"notes.md"});
        assert!(valid_knowledge_chunk(&chunk));
        let invalid_chunk=serde_json::json!({"id":"k1","documentId":"d1","projectId":"p1","text":"x".repeat(12001),"sourceLabel":"notes.md"});
        assert!(!valid_knowledge_chunk(&invalid_chunk));
    }
}


const MAX_WORKSPACE_BACKUP_BYTES: usize = 50 * 1024 * 1024;

fn export_workspace_record(connection: &Connection) -> Result<serde_json::Value, String> {
    let projects: Vec<StoredProject> = {
        let mut stmt=connection.prepare("SELECT id,name,description,created_at,updated_at,archived,schema_version FROM projects ORDER BY created_at").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok(StoredProject{id:r.get(0)?,name:r.get(1)?,description:r.get(2)?,created_at:r.get(3)?,updated_at:r.get(4)?,archived:r.get::<_,i64>(5)?!=0,schema_version:r.get(6)?})).map_err(|e|e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?
    };
    let conversations: Vec<StoredConversation> = {
        let mut stmt=connection.prepare("SELECT id,title,project_id,updated_at FROM conversations ORDER BY updated_at DESC").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,i64>(3)?))).map_err(|e|e.to_string())?;
        let metadata=rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        let mut output=Vec::new();
        for (id,title,project_id,updated_at) in metadata {
            let mut stmt=connection.prepare("SELECT id,role,content,created_at,source_references FROM messages WHERE conversation_id=?1 ORDER BY created_at,rowid").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![id],|r|{let raw:Option<String>=r.get(4)?;Ok(StoredMessage{id:r.get(0)?,role:r.get(1)?,content:r.get(2)?,created_at:r.get(3)?,source_references:raw.and_then(|v|serde_json::from_str(&v).ok())})}).map_err(|e|e.to_string())?;
            let messages=rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
            output.push(StoredConversation{id,title,project_id,messages,updated_at});
        }
        output
    };
    let read_payloads=|sql:&str| -> Result<Vec<serde_json::Value>,String> {
        let mut stmt=connection.prepare(sql).map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
        rows.map(|r|serde_json::from_str(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect()
    };
    let tool_audit_events: Vec<serde_json::Value> = {
        let mut stmt=connection.prepare("SELECT tool_id,run_id,trace_id,status,timestamp FROM tool_audit_events ORDER BY id").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok(serde_json::json!({
            "toolId":r.get::<_,String>(0)?,
            "runId":r.get::<_,String>(1)?,
            "traceId":r.get::<_,String>(2)?,
            "status":r.get::<_,String>(3)?,
            "timestamp":r.get::<_,f64>(4)?
        }))).map_err(|e|e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?
    };
    let exported_at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_secs() as i64).unwrap_or(0);
    let backup=serde_json::json!({
        "format":"nexus-au-backup",
        "schemaVersion":2,
        "exportedAt":exported_at,
        "projects":projects,
        "conversations":conversations,
        "memories":read_payloads("SELECT payload FROM memory_records ORDER BY updated_at,id")?,
        "knowledgeChunks":read_payloads("SELECT payload FROM knowledge_chunks ORDER BY project_id,document_id,id")?,
        "agentCheckpoints":read_payloads("SELECT payload FROM agent_checkpoints ORDER BY updated_at,run_id")?,
        "toolAuditEvents":tool_audit_events,
        "traceEvents":read_payloads("SELECT payload FROM trace_events ORDER BY id")?,
        "trainingDatasets":read_payloads("SELECT payload FROM training_datasets ORDER BY created_at,id,version")?,
        "trainingExperiments":read_payloads("SELECT payload FROM training_experiments ORDER BY created_at,id")?
    });
    let encoded=serde_json::to_vec(&backup).map_err(|e|e.to_string())?;
    if encoded.len()>MAX_WORKSPACE_BACKUP_BYTES {
        return Err("Workspace backup exceeds the 50 MB export limit. Reduce retained history or split the backup before exporting.".into());
    }
    Ok(backup)
}

#[tauri::command]
fn export_workspace(database: State<'_, AppDatabase>) -> Result<serde_json::Value, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    export_workspace_record(&connection)
}

fn normalize_tool_audit_event_record(event: &serde_json::Value) -> Result<serde_json::Value, String> {
    let tool_id=event_string(event,"toolId",160)?;
    let run_id=event_string(event,"runId",160)?;
    let trace_id=event_string(event,"traceId",160)?;
    let status=event_string(event,"status",20)?;
    if !["started","completed","failed","denied","reconciled"].contains(&status.as_str()) {
        return Err("Invalid audit status in workspace backup.".into());
    }
    let timestamp=event.get("timestamp").and_then(|value|value.as_f64()).filter(|value|value.is_finite())
        .ok_or("Invalid audit timestamp in workspace backup.")?;
    Ok(serde_json::json!({"toolId":tool_id,"runId":run_id,"traceId":trace_id,"status":status,"timestamp":timestamp}))
}

fn normalize_trace_event_record(event: &serde_json::Value) -> Result<serde_json::Value, String> {
    let trace_id=event_string(event,"traceId",160)?;
    let run_id=event_string(event,"runId",160)?;
    let name=event_string(event,"name",160)?;
    let status=event_string(event,"status",32)?;
    if !["started","progress","waiting_for_approval","completed","failed","cancelled"].contains(&status.as_str()) {
        return Err("Invalid trace status in workspace backup.".into());
    }
    let timestamp=event.get("timestamp").and_then(|value|value.as_f64()).filter(|value|value.is_finite())
        .ok_or("Invalid trace timestamp in workspace backup.")?;
    let parent=event.get("parentTraceId").and_then(|value|value.as_str());
    if parent.map_or(false,|value|value.trim().is_empty()||value.len()>160) {
        return Err("Invalid parent trace id in workspace backup.".into());
    }
    let duration=event.get("durationMs").and_then(|value|value.as_f64());
    if duration.map_or(false,|value|!value.is_finite()||value<0.0) {
        return Err("Invalid trace duration in workspace backup.".into());
    }
    let attributes=trace_attributes(event.get("attributes"))?;
    let mut safe=serde_json::json!({"traceId":trace_id,"runId":run_id,"name":name,"status":status,"timestamp":timestamp});
    if let Some(parent)=parent { safe["parentTraceId"]=serde_json::json!(parent); }
    if let Some(duration)=duration { safe["durationMs"]=serde_json::json!(duration); }
    if let Some(attributes)=attributes { safe["attributes"]=attributes; }
    if serde_json::to_vec(&safe).map_err(|e|e.to_string())?.len()>32_000 {
        return Err("Trace event in workspace backup exceeds the 32 KB limit.".into());
    }
    Ok(safe)
}

fn import_workspace_record(connection: &mut Connection, backup: serde_json::Value) -> Result<(), String> {
    let backup_size=serde_json::to_vec(&backup).map_err(|e|e.to_string())?.len();
    if backup_size>MAX_WORKSPACE_BACKUP_BYTES { return Err("Workspace backup exceeds the 50 MB import limit.".into()); }
    let schema_version=backup.get("schemaVersion").and_then(|value|value.as_i64()).ok_or("Backup schema version is missing.")?;
    if backup.get("format").and_then(|value|value.as_str())!=Some("nexus-au-backup") || ![1,2].contains(&schema_version) {
        return Err("Unsupported or invalid NEXUS AU backup file.".into());
    }
    let projects:Vec<StoredProject>=serde_json::from_value(backup.get("projects").cloned().ok_or("Backup projects are missing.")?).map_err(|e|e.to_string())?;
    let conversations:Vec<StoredConversation>=serde_json::from_value(backup.get("conversations").cloned().ok_or("Backup conversations are missing.")?).map_err(|e|e.to_string())?;
    let memories=backup.get("memories").and_then(|value|value.as_array()).cloned().ok_or("Backup memories are missing.")?;
    let chunks=backup.get("knowledgeChunks").and_then(|value|value.as_array()).cloned().ok_or("Backup knowledge chunks are missing.")?;
    let read_v2_array=|key:&str| -> Result<Vec<serde_json::Value>,String> {
        if schema_version==1 { return Ok(Vec::new()); }
        backup.get(key).and_then(|value|value.as_array()).cloned().ok_or_else(||format!("Backup {key} are missing or invalid."))
    };
    let agent_checkpoints=read_v2_array("agentCheckpoints")?;
    let tool_audit_events=read_v2_array("toolAuditEvents")?;
    let trace_events=read_v2_array("traceEvents")?;
    let training_datasets=read_v2_array("trainingDatasets")?;
    let training_experiments=read_v2_array("trainingExperiments")?;
    if projects.len()>10000 || conversations.len()>10000 || memories.len()>10000 || chunks.len()>50000
        || agent_checkpoints.len()>10000 || tool_audit_events.len()>MAX_PERSISTED_EVENTS as usize
        || trace_events.len()>MAX_PERSISTED_EVENTS as usize || training_datasets.len()>10000 || training_experiments.len()>10000 {
        return Err("Backup exceeds import record limits.".into());
    }

    let project_ids:HashSet<&str>=projects.iter().map(|project|project.id.as_str()).collect();
    if project_ids.len()!=projects.len() || projects.iter().any(|project|project.id.is_empty()||project.id.len()>128||project.name.trim().is_empty()||project.name.len()>80||project.description.len()>500||project.schema_version!=1) {
        return Err("Backup contains invalid or duplicate projects.".into());
    }
    let conversation_ids:HashSet<&str>=conversations.iter().map(|conversation|conversation.id.as_str()).collect();
    if conversation_ids.len()!=conversations.len() || conversations.iter().any(|conversation|conversation.id.is_empty()||conversation.id.len()>128||conversation.title.len()>120||conversation.messages.len()>20000||conversation.project_id.as_deref().map_or(false,|id|!project_ids.contains(id))) {
        return Err("Backup contains invalid or duplicate conversations.".into());
    }
    for conversation in &conversations {
        for message in &conversation.messages {
            if message.id.is_empty()||message.id.len()>128||message.content.len()>100000||!["user","assistant"].contains(&message.role.as_str()) {
                return Err("Backup contains invalid messages.".into());
            }
        }
    }
    for memory in &memories {
        if !valid_memory_record(memory) { return Err("Backup contains invalid memories.".into()); }
        let scope=memory["scope"].as_str().unwrap();
        let project_id=memory.get("projectId").and_then(|value|value.as_str());
        if scope=="project"&&project_id.map_or(true,|id|!project_ids.contains(id)) {
            return Err("Backup memory references an unknown project.".into());
        }
    }
    let mut backup_chunk_bytes:usize=0;
    for chunk in &chunks {
        if !valid_knowledge_chunk(chunk) { return Err("Backup contains invalid knowledge chunks.".into()); }
        backup_chunk_bytes=backup_chunk_bytes.saturating_add(chunk["text"].as_str().unwrap().len());
        if backup_chunk_bytes>50_000_000 { return Err("Backup knowledge exceeds the 50 MB text limit.".into()); }
        let project_id=chunk["projectId"].as_str().unwrap();
        if !project_ids.contains(project_id) { return Err("Backup knowledge chunk references an unknown project.".into()); }
    }

    let mut checkpoint_ids=HashSet::new();
    for checkpoint in &agent_checkpoints {
        if let Some(reason)=agent_checkpoint_validation_error(checkpoint) {
            return Err(format!("Backup contains an invalid agent checkpoint: {reason}."));
        }
        let run_id=checkpoint["runId"].as_str().unwrap().to_string();
        if !checkpoint_ids.insert(run_id) { return Err("Backup contains duplicate agent checkpoint run IDs.".into()); }
        if serde_json::to_vec(checkpoint).map_err(|e|e.to_string())?.len()>MAX_AGENT_CHECKPOINT_BYTES+16_384 {
            return Err("Backup agent checkpoint exceeds the size limit.".into());
        }
    }

    let mut dataset_versions:HashSet<(String,i64)>=HashSet::new();
    for dataset in &training_datasets {
        let (id,version,_)=validate_training_dataset_payload(dataset)?;
        if !dataset_versions.insert((id,version)) { return Err("Backup contains duplicate training dataset versions.".into()); }
        if serde_json::to_vec(dataset).map_err(|e|e.to_string())?.len()>MAX_TRAINING_RECORD_BYTES {
            return Err("Backup training dataset exceeds the 1 MB limit.".into());
        }
    }
    let mut experiment_ids=HashSet::new();
    for experiment in &training_experiments {
        let (id,dataset_id,dataset_version,_)=validate_training_experiment_payload(experiment)?;
        if !experiment_ids.insert(id) { return Err("Backup contains duplicate training experiment IDs.".into()); }
        if !dataset_versions.contains(&(dataset_id,dataset_version)) {
            return Err("Backup training experiment references a missing dataset version.".into());
        }
        if serde_json::to_vec(experiment).map_err(|e|e.to_string())?.len()>MAX_TRAINING_RECORD_BYTES {
            return Err("Backup training experiment exceeds the 1 MB limit.".into());
        }
    }
    let normalized_audit_events=tool_audit_events.iter().map(normalize_tool_audit_event_record).collect::<Result<Vec<_>,_>>()?;
    let normalized_trace_events=trace_events.iter().map(normalize_trace_event_record).collect::<Result<Vec<_>,_>>()?;

    let tx=connection.transaction().map_err(|e|e.to_string())?;
    tx.execute_batch("DELETE FROM training_experiments; DELETE FROM training_datasets; DELETE FROM agent_checkpoints; DELETE FROM tool_audit_events; DELETE FROM trace_events; DELETE FROM knowledge_chunks; DELETE FROM memory_records; DELETE FROM conversations; DELETE FROM projects;").map_err(|e|e.to_string())?;
    for project in projects {
        tx.execute("INSERT INTO projects(id,name,description,created_at,updated_at,archived,schema_version) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![project.id,project.name,project.description,project.created_at,project.updated_at,project.archived as i64,project.schema_version]).map_err(|e|e.to_string())?;
    }
    for conversation in conversations {
        tx.execute("INSERT INTO conversations(id,title,project_id,updated_at) VALUES(?1,?2,?3,?4)",params![conversation.id,conversation.title,conversation.project_id,conversation.updated_at]).map_err(|e|e.to_string())?;
        for message in conversation.messages {
            let refs=message.source_references.as_ref().map(serde_json::to_string).transpose().map_err(|e|e.to_string())?;
            tx.execute("INSERT INTO messages(id,conversation_id,role,content,created_at,source_references) VALUES(?1,?2,?3,?4,?5,?6)",params![message.id,conversation.id,message.role,message.content,message.created_at,refs]).map_err(|e|e.to_string())?;
        }
    }
    for memory in &memories {
        let id=memory["id"].as_str().unwrap();
        let scope=memory["scope"].as_str().unwrap();
        let project_id=memory.get("projectId").and_then(|value|value.as_str());
        let updated=memory["updatedAt"].as_i64().unwrap_or(0);
        tx.execute("INSERT INTO memory_records(id,scope,project_id,updated_at,payload) VALUES(?1,?2,?3,?4,?5)",params![id,scope,project_id,updated,serde_json::to_string(memory).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    }
    for chunk in &chunks {
        tx.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4)",params![chunk["id"].as_str().unwrap(),chunk["documentId"].as_str().unwrap(),chunk["projectId"].as_str().unwrap(),serde_json::to_string(chunk).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    }
    for checkpoint in &agent_checkpoints {
        tx.execute("INSERT INTO agent_checkpoints(run_id,agent_id,thread_id,sequence,status,updated_at,payload) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![
            checkpoint["runId"].as_str().unwrap(),checkpoint["agentId"].as_str().unwrap(),checkpoint["threadId"].as_str().unwrap(),
            checkpoint["sequence"].as_i64().unwrap(),checkpoint["status"].as_str().unwrap(),checkpoint["updatedAt"].as_f64().unwrap(),
            serde_json::to_string(checkpoint).map_err(|e|e.to_string())?
        ]).map_err(|e|e.to_string())?;
    }
    for dataset in &training_datasets {
        let (id,version,created_at)=validate_training_dataset_payload(dataset)?;
        tx.execute("INSERT INTO training_datasets(id,version,created_at,payload) VALUES(?1,?2,?3,?4)",params![id,version,created_at,serde_json::to_string(dataset).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    }
    for experiment in &training_experiments {
        let (id,dataset_id,dataset_version,created_at)=validate_training_experiment_payload(experiment)?;
        tx.execute("INSERT INTO training_experiments(id,dataset_id,created_at,payload,dataset_version) VALUES(?1,?2,?3,?4,?5)",params![id,dataset_id,created_at,serde_json::to_string(experiment).map_err(|e|e.to_string())?,dataset_version]).map_err(|e|e.to_string())?;
    }
    for event in &normalized_audit_events {
        tx.execute("INSERT INTO tool_audit_events(tool_id,run_id,trace_id,status,timestamp,detail) VALUES(?1,?2,?3,?4,?5,NULL)",params![
            event["toolId"].as_str().unwrap(),event["runId"].as_str().unwrap(),event["traceId"].as_str().unwrap(),
            event["status"].as_str().unwrap(),event["timestamp"].as_f64().unwrap()
        ]).map_err(|e|e.to_string())?;
    }
    for event in &normalized_trace_events {
        let attributes=event.get("attributes").map(serde_json::to_string).transpose().map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO trace_events(trace_id,run_id,parent_trace_id,name,status,timestamp,duration_ms,attributes,payload) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![
            event["traceId"].as_str().unwrap(),event["runId"].as_str().unwrap(),
            event.get("parentTraceId").and_then(|value|value.as_str()),event["name"].as_str().unwrap(),event["status"].as_str().unwrap(),
            event["timestamp"].as_f64().unwrap(),event.get("durationMs").and_then(|value|value.as_f64()),attributes,
            serde_json::to_string(event).map_err(|e|e.to_string())?
        ]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())
}

#[tauri::command]
fn import_workspace(database: State<'_, AppDatabase>, backup: serde_json::Value) -> Result<(), String> {
    let mut connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    import_workspace_record(&mut connection, backup)
}



const MAX_AGENT_CHECKPOINT_BYTES: usize = 256 * 1024;

fn agent_checkpoint_validation_error(checkpoint: &serde_json::Value) -> Option<&'static str> {
    let bounded_string = |field: &str, max: usize| {
        checkpoint.get(field).and_then(|value| value.as_str())
            .map_or(false, |value| !value.trim().is_empty() && value.len() <= max)
    };
    if checkpoint.get("schemaVersion").and_then(|value| value.as_i64()) != Some(1) {
        return Some("unsupported schema version");
    }
    if !bounded_string("runId", 160) || !bounded_string("agentId", 160) || !bounded_string("threadId", 160) {
        return Some("invalid run, agent, or thread identity");
    }
    if checkpoint.get("sequence").and_then(|value| value.as_i64()).map_or(true, |value| value <= 0) {
        return Some("invalid checkpoint sequence");
    }
    let status = checkpoint.get("status").and_then(|value| value.as_str()).unwrap_or("");
    if !["running", "waiting_for_approval", "completed", "failed", "cancelled"].contains(&status) {
        return Some("invalid checkpoint status");
    }
    let created_at = checkpoint.get("createdAt").and_then(|value| value.as_f64());
    let updated_at = checkpoint.get("updatedAt").and_then(|value| value.as_f64());
    if created_at.map_or(true, |value| !value.is_finite())
        || updated_at.map_or(true, |value| !value.is_finite())
        || updated_at.zip(created_at).map_or(true, |(updated, created)| updated < created) {
        return Some("invalid checkpoint timestamps");
    }
    let state_is_bounded = checkpoint.get("state").map_or(false, |value| {
        serde_json::to_vec(value).map_or(false, |bytes| bytes.len() <= MAX_AGENT_CHECKPOINT_BYTES)
    });
    if !state_is_bounded {
        return Some("missing or oversized checkpoint state");
    }
    let pending_is_valid = checkpoint.get("pendingApproval").map_or(true, |pending| {
        pending.is_null() || (
            status == "waiting_for_approval"
                && pending.get("permission").and_then(|value| value.as_str())
                    .map_or(false, |value| !value.trim().is_empty() && value.len() <= 160)
                && pending.get("requestedAt").and_then(|value| value.as_f64())
                    .map_or(false, |value| value.is_finite())
        )
    });
    if !pending_is_valid {
        return Some("invalid pending approval metadata");
    }
    None
}

fn load_agent_checkpoint_record(connection: &Connection, run_id: &str) -> Result<Option<serde_json::Value>, String> {
    if run_id.trim().is_empty() || run_id.len() > 160 {
        return Err("Agent checkpoint run id is invalid.".into());
    }
    let raw: Option<String> = connection.query_row(
        "SELECT payload FROM agent_checkpoints WHERE run_id=?1",
        params![run_id],
        |row| row.get(0)
    ).optional().map_err(|error| error.to_string())?;
    raw.map(|payload| serde_json::from_str(&payload).map_err(|error| error.to_string())).transpose()
}

fn list_agent_checkpoint_records(connection: &Connection, thread_id: &str, limit: i64) -> Result<Vec<serde_json::Value>, String> {
    if thread_id.trim().is_empty() || thread_id.len() > 160 || !(1..=200).contains(&limit) {
        return Err("Agent checkpoint thread id and a limit from 1 to 200 are required.".into());
    }
    let mut statement = connection.prepare(
        "SELECT payload FROM agent_checkpoints WHERE thread_id=?1 ORDER BY updated_at DESC,run_id LIMIT ?2"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![thread_id, limit], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&payload).map_err(|error| error.to_string())
    }).collect()
}

fn save_agent_checkpoint_record(
    connection: &mut Connection,
    checkpoint: serde_json::Value,
    expected_previous_sequence: Option<i64>
) -> Result<(), String> {
    if let Some(reason) = agent_checkpoint_validation_error(&checkpoint) {
        return Err(format!("Agent checkpoint is invalid: {reason}."));
    }
    let run_id = checkpoint["runId"].as_str().unwrap();
    let agent_id = checkpoint["agentId"].as_str().unwrap();
    let thread_id = checkpoint["threadId"].as_str().unwrap();
    let sequence = checkpoint["sequence"].as_i64().unwrap();
    let status = checkpoint["status"].as_str().unwrap();
    let updated_at = checkpoint["updatedAt"].as_f64().unwrap();
    let created_at = checkpoint["createdAt"].as_f64().unwrap();

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let previous: Option<(i64, String, String, String, String)> = transaction.query_row(
        "SELECT sequence,agent_id,thread_id,status,payload FROM agent_checkpoints WHERE run_id=?1",
        params![run_id],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))
    ).optional().map_err(|error| error.to_string())?;

    match (previous, expected_previous_sequence) {
        (None, None) if sequence == 1 => {}
        (None, _) => return Err("Checkpoint changed concurrently; reload before retrying.".into()),
        (Some(_), None) => return Err("Checkpoint changed concurrently; reload before retrying.".into()),
        (Some((previous_sequence, previous_agent, previous_thread, previous_status, previous_payload)), Some(expected)) => {
            if previous_sequence != expected || sequence != expected + 1 {
                return Err("Checkpoint changed concurrently; reload before retrying.".into());
            }
            if previous_agent != agent_id || previous_thread != thread_id {
                return Err("Checkpoint run identity cannot change.".into());
            }
            if ["completed", "failed", "cancelled"].contains(&previous_status.as_str()) {
                return Err("A terminal agent checkpoint cannot be modified.".into());
            }
            let previous_value: serde_json::Value = serde_json::from_str(&previous_payload)
                .map_err(|error| error.to_string())?;
            if previous_value.get("createdAt").and_then(|value| value.as_f64()) != Some(created_at) {
                return Err("Checkpoint creation time is immutable.".into());
            }
        }
    }

    let payload = serde_json::to_string(&checkpoint).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO agent_checkpoints(run_id,agent_id,thread_id,sequence,status,updated_at,payload) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(run_id) DO UPDATE SET sequence=excluded.sequence,status=excluded.status,updated_at=excluded.updated_at,payload=excluded.payload",
        params![run_id,agent_id,thread_id,sequence,status,updated_at,payload]
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn delete_agent_checkpoint_record(connection: &Connection, run_id: &str) -> Result<(), String> {
    if run_id.trim().is_empty() || run_id.len() > 160 {
        return Err("Agent checkpoint run id is invalid.".into());
    }
    connection.execute("DELETE FROM agent_checkpoints WHERE run_id=?1", params![run_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_agent_checkpoint(database: State<'_, AppDatabase>, run_id: String) -> Result<Option<serde_json::Value>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    load_agent_checkpoint_record(&connection, &run_id)
}

#[tauri::command]
fn list_agent_checkpoints(database: State<'_, AppDatabase>, thread_id: String, limit: i64) -> Result<Vec<serde_json::Value>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    list_agent_checkpoint_records(&connection, &thread_id, limit)
}

#[tauri::command]
fn save_agent_checkpoint(
    database: State<'_, AppDatabase>,
    checkpoint: serde_json::Value,
    expected_previous_sequence: Option<i64>
) -> Result<(), String> {
    let mut connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    save_agent_checkpoint_record(&mut connection, checkpoint, expected_previous_sequence)
}

#[tauri::command]
fn delete_agent_checkpoint(database: State<'_, AppDatabase>, run_id: String) -> Result<(), String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    delete_agent_checkpoint_record(&connection, &run_id)
}


const MAX_PERSISTED_EVENTS: i64 = 5_000;

fn event_string(event: &serde_json::Value, field: &str, max: usize) -> Result<String, String> {
    event.get(field).and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty() && value.len() <= max)
        .map(str::to_string).ok_or_else(|| format!("Invalid event field: {field}."))
}

fn record_tool_audit_event_record(connection: &mut Connection, event: serde_json::Value) -> Result<(), String> {
    let tool_id = event_string(&event, "toolId", 160)?;
    let run_id = event_string(&event, "runId", 160)?;
    let trace_id = event_string(&event, "traceId", 160)?;
    let status = event_string(&event, "status", 20)?;
    if !["started", "completed", "failed", "denied", "reconciled"].contains(&status.as_str()) { return Err("Invalid audit status.".into()); }
    let timestamp = event.get("timestamp").and_then(|v|v.as_f64()).filter(|v|v.is_finite()).ok_or("Invalid audit timestamp.")?;
    let detail = match event.get("detail") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => Some(v.as_str().filter(|s|s.len()<=1000).ok_or("Invalid audit detail.")?.to_string())
    };
    let tx=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    // The Immediate transaction makes this claim atomic across multiple windows/processes.
    // A durable started/terminal event means this run step must never execute again.
    if status == "started" {
        let already_claimed: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tool_audit_events WHERE tool_id=?1 AND run_id=?2 AND trace_id=?3 AND status IN ('started','completed','failed','reconciled'))",
            params![tool_id,run_id,trace_id],
            |row| row.get(0)
        ).map_err(|error| error.to_string())?;
        if already_claimed {
            return Err("Tool step already has a durable execution claim.".into());
        }
    }
    if status == "reconciled" {
        let has_started: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tool_audit_events WHERE tool_id=?1 AND run_id=?2 AND trace_id=?3 AND status='started')",
            params![tool_id,run_id,trace_id],
            |row| row.get(0)
        ).map_err(|error| error.to_string())?;
        let already_terminal: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tool_audit_events WHERE tool_id=?1 AND run_id=?2 AND trace_id=?3 AND status IN ('completed','reconciled'))",
            params![tool_id,run_id,trace_id],
            |row| row.get(0)
        ).map_err(|error| error.to_string())?;
        if !has_started || already_terminal {
            return Err("Only an unresolved started tool step can be manually reconciled.".into());
        }
    }
    if status == "completed" || status == "failed" {
        let reconciled: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tool_audit_events WHERE tool_id=?1 AND run_id=?2 AND trace_id=?3 AND status='reconciled')",
            params![tool_id,run_id,trace_id],
            |row| row.get(0)
        ).map_err(|error| error.to_string())?;
        if reconciled {
            return Err("A manually reconciled tool step cannot accept a late terminal result.".into());
        }
    }
    tx.execute("INSERT INTO tool_audit_events(tool_id,run_id,trace_id,status,timestamp,detail) VALUES(?1,?2,?3,?4,?5,?6)",params![tool_id,run_id,trace_id,status,timestamp,detail]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM tool_audit_events WHERE id NOT IN (SELECT id FROM tool_audit_events ORDER BY id DESC LIMIT ?1)",params![MAX_PERSISTED_EVENTS]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}

fn list_tool_audit_event_records(connection: &Connection, run_id: Option<&str>, limit: i64) -> Result<Vec<serde_json::Value>, String> {
    if !(1..=MAX_PERSISTED_EVENTS).contains(&limit) || run_id.map_or(false,|v|v.trim().is_empty()||v.len()>160) {
        return Err("Audit filter or limit is invalid.".into());
    }
    let mut statement=connection.prepare("SELECT tool_id,run_id,trace_id,status,timestamp,detail FROM tool_audit_events WHERE (?1 IS NULL OR run_id=?1) ORDER BY id DESC LIMIT ?2").map_err(|e|e.to_string())?;
    let rows=statement.query_map(params![run_id,limit],|r|{
        let detail:Option<String>=r.get(5)?;
        let mut event=serde_json::json!({
            "toolId":r.get::<_,String>(0)?,"runId":r.get::<_,String>(1)?,"traceId":r.get::<_,String>(2)?,
            "status":r.get::<_,String>(3)?,"timestamp":r.get::<_,f64>(4)?
        });
        if let Some(detail)=detail { event.as_object_mut().unwrap().insert("detail".into(),serde_json::json!(detail)); }
        Ok(event)
    }).map_err(|e|e.to_string())?;
    let mut output=rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    output.reverse();
    Ok(output)
}

fn trace_attributes(value: Option<&serde_json::Value>) -> Result<Option<serde_json::Value>, String> {
    let Some(value)=value else { return Ok(None); };
    if value.is_null() { return Ok(None); }
    let object=value.as_object().ok_or("Trace attributes must be an object.")?;
    let mut safe=serde_json::Map::new();
    for (key,item) in object {
        let lower=key.to_lowercase();
        if key.len()>60 || ["key","token","secret","password","authorization","content","prompt"].iter().any(|p|lower.contains(p)) { continue; }
        let valid=match item {
            serde_json::Value::String(s)=>s.len()<=200,
            serde_json::Value::Number(n)=>n.as_f64().map_or(false,|v|v.is_finite()),
            serde_json::Value::Bool(_)=>true,
            _=>false
        };
        if valid { safe.insert(key.clone(),item.clone()); }
    }
    let encoded=serde_json::to_vec(&safe).map_err(|e|e.to_string())?;
    if encoded.len()>16_000 { return Err("Trace attributes exceed the 16 KB limit.".into()); }
    Ok(Some(serde_json::Value::Object(safe)))
}

fn append_trace_event_record(connection: &mut Connection, event: serde_json::Value) -> Result<(), String> {
    let trace_id=event_string(&event,"traceId",160)?;
    let run_id=event_string(&event,"runId",160)?;
    let name=event_string(&event,"name",160)?;
    let status=event_string(&event,"status",32)?;
    if !["started","progress","waiting_for_approval","completed","failed","cancelled"].contains(&status.as_str()) { return Err("Invalid trace status.".into()); }
    let timestamp=event.get("timestamp").and_then(|v|v.as_f64()).filter(|v|v.is_finite()).ok_or("Invalid trace timestamp.")?;
    let parent=event.get("parentTraceId").and_then(|v|v.as_str());
    if parent.map_or(false,|v|v.trim().is_empty()||v.len()>160) { return Err("Invalid parent trace id.".into()); }
    let duration=event.get("durationMs").and_then(|v|v.as_f64());
    if duration.map_or(false,|v|!v.is_finite()||v<0.0) { return Err("Invalid trace duration.".into()); }
    let attributes=trace_attributes(event.get("attributes"))?;
    // Rebuild from the public TraceEvent contract instead of cloning untrusted
    // input. Tauri commands are a privilege boundary, so unknown top-level
    // fields must never become persistent telemetry by accident.
    let mut safe_event=serde_json::json!({
        "traceId": trace_id,
        "runId": run_id,
        "name": name,
        "status": status,
        "timestamp": timestamp
    });
    if let Some(parent)=parent {
        safe_event["parentTraceId"]=serde_json::json!(parent);
    }
    if let Some(duration)=duration {
        safe_event["durationMs"]=serde_json::json!(duration);
    }
    if let Some(value)=attributes.as_ref() {
        safe_event["attributes"]=value.clone();
    }
    let payload=serde_json::to_string(&safe_event).map_err(|e|e.to_string())?;
    if payload.len()>32_000 { return Err("Trace event exceeds the 32 KB limit.".into()); }
    let attributes_json=attributes.as_ref().map(serde_json::to_string).transpose().map_err(|e|e.to_string())?;
    let tx=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO trace_events(trace_id,run_id,parent_trace_id,name,status,timestamp,duration_ms,attributes,payload) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![trace_id,run_id,parent,name,status,timestamp,duration,attributes_json,payload]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM trace_events WHERE id NOT IN (SELECT id FROM trace_events ORDER BY id DESC LIMIT ?1)",params![MAX_PERSISTED_EVENTS]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}

fn list_trace_event_records(connection: &Connection, run_id: Option<&str>, trace_id: Option<&str>, limit: i64) -> Result<Vec<serde_json::Value>, String> {
    if !(1..=1_000).contains(&limit) || run_id.map_or(false,|v|v.trim().is_empty()||v.len()>160) ||
        trace_id.map_or(false,|v|v.trim().is_empty()||v.len()>160) { return Err("Trace filter or limit is invalid.".into()); }
    let mut statement=connection.prepare("SELECT payload FROM trace_events WHERE (?1 IS NULL OR run_id=?1) AND (?2 IS NULL OR trace_id=?2) ORDER BY id DESC LIMIT ?3").map_err(|e|e.to_string())?;
    let rows=statement.query_map(params![run_id,trace_id,limit],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
    let mut output=rows.map(|r|serde_json::from_str(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect::<Result<Vec<serde_json::Value>,String>>()?;
    output.reverse();
    Ok(output)
}

#[tauri::command]
fn record_tool_audit_event(database: State<'_, AppDatabase>, event: serde_json::Value) -> Result<(), String> {
    let mut connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    record_tool_audit_event_record(&mut connection,event)
}
#[tauri::command]
fn list_tool_audit_events(database: State<'_, AppDatabase>, run_id: Option<String>, limit: i64) -> Result<Vec<serde_json::Value>, String> {
    let connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    list_tool_audit_event_records(&connection,run_id.as_deref(),limit)
}
#[tauri::command]
fn append_trace_event(database: State<'_, AppDatabase>, event: serde_json::Value) -> Result<(), String> {
    let mut connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    append_trace_event_record(&mut connection,event)
}
#[tauri::command]
fn list_trace_events(database: State<'_, AppDatabase>, run_id: Option<String>, trace_id: Option<String>, limit: i64) -> Result<Vec<serde_json::Value>, String> {
    let connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
    list_trace_event_records(&connection,run_id.as_deref(),trace_id.as_deref(),limit)
}

#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    if text.len() > 1_000_000 { return Err("Clipboard text exceeds the 1 MB limit.".into()); }
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard is unavailable: {e}"))?;
    clipboard.set_text(text).map_err(|e| format!("Could not write clipboard: {e}"))
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard is unavailable: {e}"))?;
    let text = clipboard.get_text().map_err(|e| format!("Could not read clipboard: {e}"))?;
    if text.len() > 1_000_000 { return Err("Clipboard text exceeds the 1 MB limit.".into()); }
    Ok(text)
}


#[derive(Debug, Default, PartialEq)]
struct ParsedSseChunk {
    text: Option<String>,
    finish_reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

fn retryable_provider_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 502 | 503 | 504)
}

fn provider_retry_delay(retry_after: Option<&str>, retry_number: usize) -> std::time::Duration {
    if let Some(seconds) = retry_after.and_then(|value| value.trim().parse::<u64>().ok()) {
        return std::time::Duration::from_secs(seconds.min(10));
    }
    match retry_number {
        1 => std::time::Duration::from_millis(250),
        _ => std::time::Duration::from_millis(750),
    }
}

fn completion_reason_for_eof(finish_reason: Option<&str>) -> Result<&str, String> {
    finish_reason
        .filter(|reason| !reason.trim().is_empty())
        .ok_or_else(|| "Provider stream ended before a completion signal was received.".into())
}

fn parse_sse_chunk(data: &str) -> Result<Option<ParsedSseChunk>, String> {
    if data.trim() == "[DONE]" { return Ok(None); }
    let payload: serde_json::Value = serde_json::from_str(data)
        .map_err(|_| "Provider sent an invalid streaming event.".to_string())?;
    if let Some(error) = payload.get("error") {
        let message = error.get("message").and_then(|v| v.as_str()).unwrap_or("Provider streaming error.");
        return Err(message.chars().take(500).collect());
    }
    let choice = payload.get("choices").and_then(|v| v.as_array())
        .and_then(|items| items.first());
    let delta = choice.and_then(|v| v.get("delta")).and_then(|v| v.get("content"));
    let text = match delta {
        Some(serde_json::Value::String(value)) => Some(value.clone()),
        Some(serde_json::Value::Array(parts)) => Some(parts.iter()
            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
            .collect::<String>()),
        _ => None
    };
    let finish_reason = choice.and_then(|v| v.get("finish_reason"))
        .and_then(|v| v.as_str()).map(str::to_owned);
    let usage = payload.get("usage");
    let input_tokens = usage.and_then(|v| v.get("prompt_tokens").or_else(|| v.get("input_tokens")))
        .and_then(|v| v.as_u64());
    let output_tokens = usage.and_then(|v| v.get("completion_tokens").or_else(|| v.get("output_tokens")))
        .and_then(|v| v.as_u64());
    Ok(Some(ParsedSseChunk { text, finish_reason, input_tokens, output_tokens }))
}

fn forward_sse_chunk(
    on_event: &tauri::ipc::Channel<serde_json::Value>,
    data: &str,
    finish_reason: &mut Option<String>,
    api_key: Option<&str>,
    redactor: &mut ProviderSecretRedactor,
) -> Result<bool, String> {
    if data.trim() == "[DONE]" { return Ok(true); }
    let parsed = parse_sse_chunk(data).map_err(|error| redact_provider_secret(&error, api_key))?;
    if let Some(chunk) = parsed {
        if let Some(text) = chunk.text.filter(|value| !value.is_empty()) {
            let safe_text = redactor.push(&text);
            if !safe_text.is_empty() {
                on_event.send(serde_json::json!({"type":"text_delta","text":safe_text}))
                    .map_err(|_| "The chat stream consumer disconnected.".to_string())?;
            }
        }
        if chunk.input_tokens.is_some() || chunk.output_tokens.is_some() {
            on_event.send(serde_json::json!({
                "type":"usage",
                "inputTokens":chunk.input_tokens,
                "outputTokens":chunk.output_tokens
            })).map_err(|_| "The chat stream consumer disconnected.".to_string())?;
        }
        if chunk.finish_reason.is_some() {
            *finish_reason = chunk.finish_reason;
        }
    }
    Ok(false)
}

fn flush_provider_secret_redactor(
    on_event: &tauri::ipc::Channel<serde_json::Value>,
    redactor: &mut ProviderSecretRedactor,
) -> Result<(), String> {
    let remaining = redactor.finish();
    if !remaining.is_empty() {
        on_event.send(serde_json::json!({"type":"text_delta","text":remaining}))
            .map_err(|_| "The chat stream consumer disconnected.".to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn send_chat_stream(
    base_url: String,
    credential_handle: String,
    model: String,
    messages: Vec<ProviderInputMessage>,
    temperature: Option<f32>,
    max_output_tokens: Option<u32>,
    stream_id: String,
    on_event: tauri::ipc::Channel<serde_json::Value>,
    streams: State<'_, ActiveChatStreams>,
) -> Result<(), String> {
    if !valid_stream_id(&stream_id) {
        return Err("Stream ID is invalid.".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = streams.0.lock().map_err(|_| "Stream registry is unavailable.")?;
        register_active_stream(&mut active, &stream_id, cancelled.clone())?;
    }
    let _registration = ActiveStreamGuard { streams: streams.0.clone(), stream_id };
    let mut endpoint = reqwest::Url::parse(base_url.trim())
        .map_err(|_| "Provider URL is invalid.".to_string())?;
    let host = endpoint.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if endpoint.scheme() != "https" && !(endpoint.scheme() == "http" && loopback) {
        return Err("Provider URL must use HTTPS (HTTP is allowed only for loopback hosts).".into());
    }
    if !endpoint.username().is_empty() || endpoint.password().is_some()
        || endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("Provider URL cannot contain credentials, query parameters, or fragments.".into());
    }
    if !endpoint.path().trim_end_matches('/').ends_with("/chat/completions") {
        let path = format!("{}/chat/completions", endpoint.path().trim_end_matches('/'));
        endpoint.set_path(&path);
    }
    if !valid_provider_model_id(&model) || messages.is_empty() || messages.len() > 100 {
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
    validate_generation_parameters(temperature, max_output_tokens)?;
    let api_key = load_provider_credential(&credential_handle, loopback)?;
    let mut payload = serde_json::json!({
        "model": model.trim(),
        "messages": messages.iter().map(|m| serde_json::json!({"role":m.role,"content":m.content})).collect::<Vec<_>>(),
        "stream": true
    });
    if let Some(value) = temperature { payload["temperature"] = serde_json::json!(value); }
    if let Some(value) = max_output_tokens { payload["max_tokens"] = serde_json::json!(value); }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| format!("Could not configure provider client: {e}"))?;
    // Retry only explicit transient HTTP responses, and only before SSE bytes
    // are consumed. Ambiguous transport failures are never replayed.
    let mut response = None;
    for attempt in 0..=2 {
        let mut request = client.post(endpoint.clone()).json(&payload);
        if let Some(key) = api_key.as_deref() { request = request.bearer_auth(key); }
        let send_result = tokio::select! {
            result = request.send() => result,
            _ = wait_for_stream_cancellation(cancelled.clone()) => return Err("Provider streaming request cancelled.".into())
        };
        let current = send_result
            .map_err(|e| format!("Provider streaming request failed: {e}"))?;
        if retryable_provider_status(current.status()) && attempt < 2 {
            let retry_after = current.headers().get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok()).map(str::to_owned);
            drop(current);
            let delay = provider_retry_delay(retry_after.as_deref(), attempt + 1);
            tokio::select! {
                _ = tokio::time::sleep(delay) => {},
                _ = wait_for_stream_cancellation(cancelled.clone()) => return Err("Provider streaming request cancelled.".into())
            }
            continue;
        }
        response = Some(current);
        break;
    }
    let mut response = response.ok_or_else(|| "Provider request did not produce a response.".to_string())?;
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
        let mut raw = String::from_utf8_lossy(&body).into_owned();
        if let Some(secret) = api_key.as_deref().filter(|secret| !secret.is_empty()) {
            raw = raw.replace(secret, "[redacted]");
        }
        return Err(format!("Provider returned HTTP {status}: {}",raw.chars().take(500).collect::<String>()));
    }

    let mut pending=Vec::<u8>::new();
    let mut event_data=String::new();
    let mut total=0usize;
    let mut completed=false;
    let mut finish_reason: Option<String> = None;
    let mut secret_redactor = ProviderSecretRedactor::new(api_key.as_deref());
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
                    if forward_sse_chunk(&on_event, &data, &mut finish_reason, api_key.as_deref(), &mut secret_redactor)? {
                        flush_provider_secret_redactor(&on_event, &mut secret_redactor)?;
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
            if forward_sse_chunk(&on_event, event_data.trim_end_matches('\n'), &mut finish_reason, api_key.as_deref(), &mut secret_redactor)? {
                flush_provider_secret_redactor(&on_event, &mut secret_redactor)?;
                on_event.send(serde_json::json!({"type":"completed","finishReason":finish_reason.as_deref().unwrap_or("unknown")}))
                    .map_err(|_| "The chat stream consumer disconnected.".to_string())?;
                completed = true;
            }
        }
        // Some compatible providers omit the final [DONE] marker but still send
        // a finish_reason. Accept that explicit terminal signal, never a bare EOF.
        if !completed {
            let terminal_reason = completion_reason_for_eof(finish_reason.as_deref())?;
            flush_provider_secret_redactor(&on_event, &mut secret_redactor)?;
            on_event.send(serde_json::json!({"type":"completed","finishReason":terminal_reason}))
                .map_err(|_| "The chat stream consumer disconnected.".to_string())?;
            completed = true;
        }
    }
    if !completed {
        return Err("Provider stream ended before a completion signal was received.".into());
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
    let mut endpoint = reqwest::Url::parse(base_url.trim())
        .map_err(|_| "Provider URL is invalid.".to_string())?;
    let host = endpoint.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if endpoint.scheme() != "https" && !(endpoint.scheme() == "http" && loopback) {
        return Err("Provider URL must use HTTPS (HTTP is allowed only for loopback hosts).".into());
    }
    if !endpoint.username().is_empty() || endpoint.password().is_some()
        || endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("Provider URL cannot contain credentials, query parameters, or fragments.".into());
    }
    if endpoint.path().trim_end_matches('/').ends_with("/chat/completions") {
        // The configured endpoint already includes the OpenAI-compatible route.
    } else {
        let path = format!("{}/chat/completions", endpoint.path().trim_end_matches('/'));
        endpoint.set_path(&path);
    }
    if !valid_provider_model_id(&model) || messages.is_empty() || messages.len() > 100 {
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
    let content = data.choices.into_iter().next().map(|choice| choice.message.content)
        .ok_or_else(|| "Provider returned an empty response.".to_string())?;
    Ok(redact_provider_secret(&content, api_key.as_deref()))
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
    let mut endpoint = reqwest::Url::parse(base_url.trim())
        .map_err(|_| "Provider URL is invalid.".to_string())?;
    let host = endpoint.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if endpoint.scheme() != "https" && !(endpoint.scheme() == "http" && loopback) {
        return Err("Provider URL must use HTTPS (HTTP is allowed only for loopback hosts).".into());
    }
    if !endpoint.username().is_empty() || endpoint.password().is_some()
        || endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("Provider URL cannot contain credentials, query parameters, or fragments.".into());
    }
    if !endpoint.path().trim_end_matches('/').ends_with("/models") {
        let path = format!("{}/models", endpoint.path().trim_end_matches('/'));
        endpoint.set_path(&path);
    }

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
            if sample_id.trim().is_empty() || sample_id.trim() != sample_id || sample_id.len() > 160
                || sample_id.chars().any(char::is_control) || sample_id.contains(',')
                || !local.insert(sample_id.to_string()) || !all_ids.insert(sample_id.to_string()) {
                return Err("Training dataset splits must contain unique, disjoint sample IDs.".into());
            }
        }
    }
    if let Some(samples_value) = value.get("samples") {
        let samples = samples_value.as_array().ok_or_else(|| "Training dataset samples must be an array.".to_string())?;
        if samples.len() != all_ids.len() || samples.len() > 300_000 {
            return Err("Training dataset sample count must match the declared splits.".into());
        }
        let mut sample_ids = HashSet::new();
        let mut total_bytes = 0usize;
        for sample in samples {
            let sample_id = sample.get("id").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "Training sample ID is required.".to_string())?;
            let split = sample.get("split").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "Training sample split is required.".to_string())?;
            let input = sample.get("input").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "Training sample input is required.".to_string())?;
            let expected = sample.get("expectedOutput").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "Training sample expected output is required.".to_string())?;
            if sample_id.trim().is_empty() || sample_id.trim() != sample_id || sample_id.len() > 160
                || sample_id.chars().any(char::is_control) || sample_id.contains(',')
                || input.trim().is_empty() || input.len() > 12_000
                || expected.trim().is_empty() || expected.len() > 12_000
                || !["train", "validation", "test"].contains(&split)
                || !all_ids.contains(sample_id) || !sample_ids.insert(sample_id.to_string()) {
                return Err("Training dataset contains an invalid or duplicate sample.".into());
            }
            let split_values = splits.get(split).and_then(serde_json::Value::as_array).unwrap();
            if !split_values.iter().any(|item| item.as_str() == Some(sample_id)) {
                return Err("Training sample split does not match its manifest split IDs.".into());
            }
            total_bytes = total_bytes.saturating_add(sample_id.len()).saturating_add(input.len()).saturating_add(expected.len());
            if total_bytes > 900_000 {
                return Err("Training dataset samples exceed the 900 KB content limit.".into());
            }
        }
        if sample_ids != all_ids {
            return Err("Training dataset sample IDs must exactly match the manifest split IDs.".into());
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut connection = Connection::open(data_dir.join("nexus-au.sqlite"))?;
            connection.execute_batch("PRAGMA foreign_keys = ON;")?;
            migrate_database(&mut connection)?;
            app.manage(AppDatabase(Mutex::new(connection)));
            app.manage(ActiveChatStreams::default());
            app.manage(workspace_fs::WorkspaceAccess::load(data_dir.join("allowed-workspace-directories.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_app_version, send_chat, send_chat_stream, cancel_chat_stream, list_provider_models, save_training_dataset, list_training_datasets, save_training_experiment, list_training_experiments, load_conversations, save_conversations, load_projects, save_project, delete_project, load_memories, save_memory, delete_memory, load_knowledge_chunks, save_knowledge_chunks, replace_knowledge_document, delete_knowledge_document, export_workspace, import_workspace, store_provider_key, provider_vault_status, has_provider_key, delete_provider_key, load_agent_checkpoint, list_agent_checkpoints, save_agent_checkpoint, delete_agent_checkpoint, record_tool_audit_event, list_tool_audit_events, append_trace_event, list_trace_events, write_clipboard, read_clipboard, workspace_fs::list_workspace_directories, workspace_fs::grant_workspace_directory, workspace_fs::revoke_workspace_directory, workspace_fs::list_workspace_entries, workspace_fs::read_workspace_file, workspace_fs::write_workspace_file, workspace_fs::write_workspace_file_checked, workspace_fs::create_workspace_directory, workspace_fs::search_workspace_entries, workspace_fs_search::search_workspace_contents, workspace_fs_ops::rename_workspace_entry, workspace_fs_ops::rename_workspace_entries_batch, workspace_fs_ops::move_workspace_entry, workspace_fs_ops::read_workspace_image_preview])
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
        let mut unsafe_id = valid.clone();
        unsafe_id["splits"]["train"] = serde_json::json!(["bad\nid"]);
        assert!(validate_training_dataset_payload(&unsafe_id).is_err());
        unsafe_id["splits"]["train"] = serde_json::json!(["bad,id"]);
        assert!(validate_training_dataset_payload(&unsafe_id).is_err());
        let mut overlap = valid.clone();
        overlap["splits"]["test"] = serde_json::json!(["a"]);
        assert!(validate_training_dataset_payload(&overlap).is_err());
        let mut private = valid.clone();
        private["privacyClass"] = serde_json::json!("owner_approved");
        private["consentStatus"] = serde_json::json!("pending");
        assert!(validate_training_dataset_payload(&private).is_err());

        let mut with_samples = valid.clone();
        with_samples["samples"] = serde_json::json!([
            {"id":"a","split":"train","input":"prompt","expectedOutput":"answer"},
            {"id":"b","split":"validation","input":"prompt","expectedOutput":"answer"},
            {"id":"c","split":"test","input":"prompt","expectedOutput":"answer"}
        ]);
        assert!(validate_training_dataset_payload(&with_samples).is_ok());
        with_samples["samples"][0]["split"] = serde_json::json!("test");
        assert!(validate_training_dataset_payload(&with_samples).is_err());
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
    fn stream_ids_are_bounded_and_safe() {
        assert!(valid_stream_id("stream-123_ABC"));
        assert!(!valid_stream_id(""));
        assert!(!valid_stream_id("bad/id"));
        assert!(!valid_stream_id("bad id"));
        assert!(!valid_stream_id(&"x".repeat(129)));
    }

    #[test]
    fn provider_retries_only_transient_http_statuses() {
        assert!(retryable_provider_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(retryable_provider_status(reqwest::StatusCode::BAD_GATEWAY));
        assert!(retryable_provider_status(reqwest::StatusCode::SERVICE_UNAVAILABLE));
        assert!(retryable_provider_status(reqwest::StatusCode::GATEWAY_TIMEOUT));
        assert!(!retryable_provider_status(reqwest::StatusCode::UNAUTHORIZED));
        assert!(!retryable_provider_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!retryable_provider_status(reqwest::StatusCode::INTERNAL_SERVER_ERROR));
    }

    #[test]
    fn provider_retry_delay_respects_numeric_retry_after_and_caps_wait() {
        assert_eq!(provider_retry_delay(Some("3"), 1), std::time::Duration::from_secs(3));
        assert_eq!(provider_retry_delay(Some("999"), 2), std::time::Duration::from_secs(10));
        assert_eq!(provider_retry_delay(Some("invalid"), 1), std::time::Duration::from_millis(250));
        assert_eq!(provider_retry_delay(None, 2), std::time::Duration::from_millis(750));
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
    fn native_audit_claim_prevents_duplicate_started_events_atomically() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        let started=serde_json::json!({"toolId":"notes.write","runId":"run-1","traceId":"step-1","status":"started","timestamp":1.0});
        record_tool_audit_event_record(&mut connection,started.clone()).expect("first claim");
        assert!(record_tool_audit_event_record(&mut connection,started.clone()).is_err());

        let completed=serde_json::json!({"toolId":"notes.write","runId":"run-1","traceId":"step-1","status":"completed","timestamp":2.0});
        record_tool_audit_event_record(&mut connection,completed).expect("terminal event");
        assert!(record_tool_audit_event_record(&mut connection,started).is_err());

        let denied=serde_json::json!({"toolId":"notes.write","runId":"run-1","traceId":"step-2","status":"denied","timestamp":3.0});
        record_tool_audit_event_record(&mut connection,denied).expect("denied attempt");
        let retry=serde_json::json!({"toolId":"notes.write","runId":"run-1","traceId":"step-2","status":"started","timestamp":4.0});
        record_tool_audit_event_record(&mut connection,retry).expect("retry after denial");
    }

    #[test]
    fn native_audit_reconciliation_is_atomic_and_blocks_replay() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        let started=serde_json::json!({"toolId":"workspace.write","runId":"run-1","traceId":"step-1","status":"started","timestamp":1.0});
        record_tool_audit_event_record(&mut connection,started.clone()).expect("record started event");
        let reconciled=serde_json::json!({
            "toolId":"workspace.write","runId":"run-1","traceId":"step-1",
            "status":"reconciled","timestamp":2.0,"detail":"Owner reviewed the external outcome."
        });
        record_tool_audit_event_record(&mut connection,reconciled.clone()).expect("reconcile ambiguous step");
        assert!(record_tool_audit_event_record(&mut connection,reconciled).is_err(),"reconciliation is terminal");
        assert!(record_tool_audit_event_record(&mut connection,started).is_err(),"reconciled steps cannot be replayed");
        let late=serde_json::json!({"toolId":"workspace.write","runId":"run-1","traceId":"step-1","status":"completed","timestamp":3.0});
        assert!(record_tool_audit_event_record(&mut connection,late).is_err(),"late terminal result cannot overwrite owner reconciliation");
        let listed=list_tool_audit_event_records(&connection,Some("run-1"),10).expect("list audit");
        assert_eq!(listed.len(),2);
        assert_eq!(listed[1]["status"],"reconciled");
    }

    #[test]
    fn failed_tool_steps_can_be_manually_reconciled_after_owner_review() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        record_tool_audit_event_record(&mut connection,serde_json::json!({
            "toolId":"workspace.write","runId":"run-1","traceId":"step-1","status":"started","timestamp":1.0
        })).expect("start tool");
        record_tool_audit_event_record(&mut connection,serde_json::json!({
            "toolId":"workspace.write","runId":"run-1","traceId":"step-1","status":"failed","timestamp":2.0,"detail":"timeout"
        })).expect("record uncertain failure");
        record_tool_audit_event_record(&mut connection,serde_json::json!({
            "toolId":"workspace.write","runId":"run-1","traceId":"step-1","status":"reconciled","timestamp":3.0
        })).expect("owner reconciles uncertain result");
    }

    #[test]
    fn reconciliation_requires_an_unresolved_started_step() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        migrate_database(&mut connection).expect("apply migrations");
        let reconciled=serde_json::json!({"toolId":"workspace.write","runId":"run-1","traceId":"step-1","status":"reconciled","timestamp":2.0});
        assert!(record_tool_audit_event_record(&mut connection,reconciled).is_err());
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
        assert_eq!(exported["schemaVersion"], 2);
        assert_eq!(exported["agentCheckpoints"], serde_json::json!([]));
        assert_eq!(exported["toolAuditEvents"], serde_json::json!([]));
        assert_eq!(exported["traceEvents"], serde_json::json!([]));
        assert_eq!(exported["trainingDatasets"], serde_json::json!([]));
        assert_eq!(exported["trainingExperiments"], serde_json::json!([]));
        assert_eq!(exported["projects"][0]["id"], "project-1");
        assert_eq!(exported["conversations"][0]["messages"][0]["content"], "Hello");
        assert_eq!(exported["memories"][0]["content"], "A saved fact");
        assert_eq!(exported["knowledgeChunks"][0]["text"], "A source passage");
        assert!(exported.get("providerKeys").is_none(), "provider credentials must never be exported");
    }

    #[test]
    fn workspace_backup_v2_round_trips_agent_training_and_observability_records() {
        let mut source = Connection::open_in_memory().expect("source SQLite");
        source.execute_batch("PRAGMA foreign_keys = ON;").expect("enable source foreign keys");
        migrate_database(&mut source).expect("create source schema");
        import_workspace_record(&mut source, sample_backup()).expect("seed core workspace");

        let dataset = serde_json::json!({
            "schemaVersion":1,"id":"dataset-backup","version":1,"name":"Backup dataset",
            "license":"CC0-1.0","privacyClass":"synthetic","consentStatus":"not_required",
            "sourceReferences":["generated:backup-test"],"createdAt":100,
            "splits":{"train":["a"],"validation":["b"],"test":["c"]}
        });
        save_training_dataset_record(&source, &dataset).expect("save training dataset");
        let experiment = serde_json::json!({
            "schemaVersion":1,"id":"experiment-backup","name":"Backup experiment","modelId":"gateway/model",
            "method":"baseline","datasetManifestId":"dataset-backup","datasetManifestVersion":1,
            "codeRevision":"abc1234","hardware":"CI runner","configuration":{"temperature":0.0},
            "metrics":{"passRate":0.75},"createdAt":200
        });
        save_training_experiment_record(&source, &experiment).expect("save training experiment");
        let saved_checkpoint = checkpoint(1, "running");
        save_agent_checkpoint_record(&mut source, saved_checkpoint.clone(), None).expect("save agent checkpoint");
        record_tool_audit_event_record(&mut source, serde_json::json!({
            "toolId":"workspace.read","runId":"run-1","traceId":"trace-1","status":"completed",
            "timestamp":300.0,"detail":"this detail must not be included in a backup"
        })).expect("save audit event");
        append_trace_event_record(&mut source, serde_json::json!({
            "traceId":"trace-1","runId":"run-1","name":"agent.step","status":"completed","timestamp":301.0,
            "durationMs":5.0,"attributes":{"step":1,"label":"safe","apiKey":"must-not-export","prompt":"must-not-export"},
            "apiKey":"must-not-export","prompt":"must-not-export"
        })).expect("save trace event");

        let backup = export_workspace_record(&source).expect("export v2 backup");
        assert_eq!(backup["schemaVersion"], 2);
        assert_eq!(backup["agentCheckpoints"].as_array().unwrap().len(), 1);
        assert_eq!(backup["toolAuditEvents"].as_array().unwrap().len(), 1);
        assert_eq!(backup["traceEvents"].as_array().unwrap().len(), 1);
        assert_eq!(backup["trainingDatasets"].as_array().unwrap().len(), 1);
        assert_eq!(backup["trainingExperiments"].as_array().unwrap().len(), 1);
        assert!(backup["toolAuditEvents"][0].get("detail").is_none());
        assert!(backup["traceEvents"][0].get("apiKey").is_none());
        assert!(backup["traceEvents"][0].get("attributes").unwrap().get("apiKey").is_none());
        assert!(backup.get("providerKeys").is_none());

        let mut restored = Connection::open_in_memory().expect("restored SQLite");
        restored.execute_batch("PRAGMA foreign_keys = ON;").expect("enable restored foreign keys");
        migrate_database(&mut restored).expect("create restored schema");
        import_workspace_record(&mut restored, backup.clone()).expect("restore v2 backup");
        assert_eq!(load_agent_checkpoint_record(&restored, "run-1").expect("load checkpoint"), Some(saved_checkpoint));
        assert_eq!(list_training_dataset_records(&restored).expect("list datasets"), vec![dataset]);
        assert_eq!(list_training_experiment_records(&restored).expect("list experiments"), vec![experiment]);
        let audit = list_tool_audit_event_records(&restored, Some("run-1"), 10).expect("list audit");
        assert_eq!(audit.len(), 1);
        assert!(audit[0].get("detail").is_none());
        let traces = list_trace_event_records(&restored, Some("run-1"), Some("trace-1"), 10).expect("list traces");
        assert_eq!(traces.len(), 1);
        assert_eq!(traces[0]["attributes"]["label"], "safe");
        assert!(traces[0]["attributes"].get("apiKey").is_none());

        let before_invalid_import = export_workspace_record(&restored).expect("export before invalid import");
        let mut invalid = backup;
        invalid["trainingExperiments"][0]["datasetManifestVersion"] = serde_json::json!(99);
        assert!(import_workspace_record(&mut restored, invalid).is_err());
        let after_invalid_import = export_workspace_record(&restored).expect("export after invalid import");
        assert_eq!(before_invalid_import["agentCheckpoints"], after_invalid_import["agentCheckpoints"]);
        assert_eq!(before_invalid_import["trainingDatasets"], after_invalid_import["trainingDatasets"]);
        assert_eq!(before_invalid_import["trainingExperiments"], after_invalid_import["trainingExperiments"]);
        assert_eq!(before_invalid_import["toolAuditEvents"], after_invalid_import["toolAuditEvents"]);
        assert_eq!(before_invalid_import["traceEvents"], after_invalid_import["traceEvents"]);
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
    fn upgrades_schema_version_four_atomically_to_nine() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("create current schema");
        connection.pragma_update(None, "user_version", 4).expect("simulate v4");
        connection.execute_batch("DROP TABLE trace_events; DROP TABLE tool_audit_events; DROP TABLE agent_checkpoints; DROP TABLE training_experiments; DROP TABLE training_datasets;").expect("remove v5 and v6 tables");
        migrate_database(&mut connection).expect("upgrade v4 to v9");
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).expect("schema version");
        assert_eq!(version, 9);
        let table: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='agent_checkpoints'", [], |row| row.get(0)).expect("checkpoint table");
        assert_eq!(table, 1);
        let audit: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tool_audit_events'", [], |row| row.get(0)).expect("audit table");
        assert_eq!(audit, 1);
    }

    #[test]
    fn schema_v8_upgrade_preserves_audit_history_and_adds_reconciled_status() {
        let mut connection=Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("CREATE TABLE tool_audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,tool_id TEXT NOT NULL,run_id TEXT NOT NULL,trace_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('started','completed','failed','denied')),timestamp REAL NOT NULL,detail TEXT); CREATE INDEX idx_tool_audit_run_id ON tool_audit_events(run_id,id DESC); INSERT INTO tool_audit_events(tool_id,run_id,trace_id,status,timestamp,detail) VALUES('tool.read','run-legacy','trace-legacy','completed',1.0,'preserve me'); PRAGMA user_version=8;").expect("create v8 schema");
        migrate_database(&mut connection).expect("upgrade schema to v9");
        let version:i64=connection.pragma_query_value(None,"user_version",|row|row.get(0)).expect("schema version");
        assert_eq!(version,9);
        let events=list_tool_audit_event_records(&connection,Some("run-legacy"),10).expect("load preserved audit history");
        assert_eq!(events.len(),1);
        assert_eq!(events[0]["detail"],"preserve me");
        let started=serde_json::json!({"toolId":"tool.write","runId":"run-new","traceId":"trace-new","status":"started","timestamp":2.0});
        record_tool_audit_event_record(&mut connection,started).expect("record start after migration");
        let reconciled=serde_json::json!({"toolId":"tool.write","runId":"run-new","traceId":"trace-new","status":"reconciled","timestamp":3.0});
        record_tool_audit_event_record(&mut connection,reconciled).expect("new status accepted after migration");
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
        assert_eq!(version, 9);
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
