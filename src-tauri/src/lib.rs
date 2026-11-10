use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashSet;
use std::sync::Mutex;
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

fn validate_provider_key(api_key: &str) -> Result<&str, &'static str> {
    let normalized = api_key.trim();
    if normalized.is_empty() { return Err("API key cannot be empty."); }
    if normalized.len() > 8192 { return Err("API key exceeds the 8 KB limit."); }
    if normalized.chars().any(char::is_control) { return Err("API key contains unsupported control characters."); }
    Ok(normalized)
}

#[tauri::command]
fn store_provider_key(api_key: String) -> Result<(), String> {
    let normalized = validate_provider_key(&api_key).map_err(str::to_owned)?;
    credential_entry("default")?.set_password(normalized).map_err(|e| format!("Could not store API key in the OS credential vault: {e}"))
}

fn classify_provider_vault_status(entry_available: bool, credential_present: Option<bool>) -> &'static str {
    if !entry_available { return "unavailable"; }
    match credential_present {
        Some(true) => "available",
        Some(false) => "missing",
        None => "unavailable"
    }
}

#[tauri::command]
fn provider_vault_status() -> &'static str {
    match credential_entry("default") {
        Ok(entry) => match entry.get_password() {
            Ok(secret) => classify_provider_vault_status(true, Some(!secret.is_empty())),
            Err(keyring::Error::NoEntry) => classify_provider_vault_status(true, Some(false)),
            Err(_) => classify_provider_vault_status(true, None)
        },
        Err(_) => classify_provider_vault_status(false, None)
    }
}

#[tauri::command]
fn has_provider_key() -> bool {
    provider_vault_status() == "available"
}

#[tauri::command]
fn delete_provider_key() -> Result<(), String> {
    match credential_entry("default")?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete API key from the OS credential vault: {e}"))
    }

}

#[cfg(test)]
mod payload_validation_tests {
    use super::*;
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
    let exported_at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_secs() as i64).unwrap_or(0);
    Ok(serde_json::json!({"format":"nexus-au-backup","schemaVersion":1,"exportedAt":exported_at,"projects":projects,"conversations":conversations,"memories":read_payloads("SELECT payload FROM memory_records")?,"knowledgeChunks":read_payloads("SELECT payload FROM knowledge_chunks")?}))
}

#[tauri::command]
fn export_workspace(database: State<'_, AppDatabase>) -> Result<serde_json::Value, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    export_workspace_record(&connection)
}

fn import_workspace_record(connection: &mut Connection, backup: serde_json::Value) -> Result<(), String> {
    if backup.get("format").and_then(|v|v.as_str())!=Some("nexus-au-backup") || backup.get("schemaVersion").and_then(|v|v.as_i64())!=Some(1) { return Err("Unsupported or invalid NEXUS AU backup file.".into()); }
    let projects:Vec<StoredProject>=serde_json::from_value(backup.get("projects").cloned().ok_or("Backup projects are missing.")?).map_err(|e|e.to_string())?;
    let conversations:Vec<StoredConversation>=serde_json::from_value(backup.get("conversations").cloned().ok_or("Backup conversations are missing.")?).map_err(|e|e.to_string())?;
    let memories=backup.get("memories").and_then(|v|v.as_array()).ok_or("Backup memories are missing.")?;
    let chunks=backup.get("knowledgeChunks").and_then(|v|v.as_array()).ok_or("Backup knowledge chunks are missing.")?;
    if projects.len()>10000 || conversations.len()>10000 || memories.len()>10000 || chunks.len()>50000 { return Err("Backup exceeds import limits.".into()); }
    let project_ids:HashSet<&str>=projects.iter().map(|p|p.id.as_str()).collect();
    if project_ids.len()!=projects.len() || projects.iter().any(|p|p.id.is_empty()||p.id.len()>128||p.name.trim().is_empty()||p.name.len()>80||p.description.len()>500||p.schema_version!=1) { return Err("Backup contains invalid or duplicate projects.".into()); }
    let conversation_ids:HashSet<&str>=conversations.iter().map(|c|c.id.as_str()).collect();
    if conversation_ids.len()!=conversations.len() || conversations.iter().any(|c|c.id.is_empty()||c.id.len()>128||c.title.len()>120||c.messages.len()>20000||c.project_id.as_deref().map_or(false,|id|!project_ids.contains(id))) { return Err("Backup contains invalid or duplicate conversations.".into()); }
    for c in &conversations { for m in &c.messages { if m.id.is_empty()||m.id.len()>128||m.content.len()>100000||!["user","assistant"].contains(&m.role.as_str()) { return Err("Backup contains invalid messages.".into()); } } }
    for m in memories {
        if !valid_memory_record(m) { return Err("Backup contains invalid memories.".into()); }
        let scope=m["scope"].as_str().unwrap();
        let pid=m.get("projectId").and_then(|v|v.as_str());
        if scope=="project"&&pid.map_or(true,|p|!project_ids.contains(p)) { return Err("Backup memory references an unknown project.".into()); }
    }
    let mut backup_chunk_bytes:usize=0;
    for c in chunks {
        if !valid_knowledge_chunk(c) { return Err("Backup contains invalid knowledge chunks.".into()); }
        backup_chunk_bytes=backup_chunk_bytes.saturating_add(c["text"].as_str().unwrap().len());
        if backup_chunk_bytes>50_000_000 { return Err("Backup knowledge exceeds the 50 MB text limit.".into()); }
        let pid=c["projectId"].as_str().unwrap();
        if !project_ids.contains(pid) { return Err("Backup knowledge chunk references an unknown project.".into()); }
    }
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    tx.execute_batch("DELETE FROM knowledge_chunks; DELETE FROM memory_records; DELETE FROM conversations; DELETE FROM projects;").map_err(|e|e.to_string())?;
    for p in projects { tx.execute("INSERT INTO projects(id,name,description,created_at,updated_at,archived,schema_version) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![p.id,p.name,p.description,p.created_at,p.updated_at,p.archived as i64,p.schema_version]).map_err(|e|e.to_string())?; }
    for c in conversations {
        tx.execute("INSERT INTO conversations(id,title,project_id,updated_at) VALUES(?1,?2,?3,?4)",params![c.id,c.title,c.project_id,c.updated_at]).map_err(|e|e.to_string())?;
        for m in c.messages { let refs=m.source_references.as_ref().map(serde_json::to_string).transpose().map_err(|e|e.to_string())?; tx.execute("INSERT INTO messages(id,conversation_id,role,content,created_at,source_references) VALUES(?1,?2,?3,?4,?5,?6)",params![m.id,c.id,m.role,m.content,m.created_at,refs]).map_err(|e|e.to_string())?; }
    }
    for m in memories { let id=m["id"].as_str().unwrap();let scope=m["scope"].as_str().unwrap();let pid=m.get("projectId").and_then(|v|v.as_str());let updated=m["updatedAt"].as_i64().unwrap_or(0);tx.execute("INSERT INTO memory_records(id,scope,project_id,updated_at,payload) VALUES(?1,?2,?3,?4,?5)",params![id,scope,pid,updated,serde_json::to_string(m).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?; }
    for c in chunks { tx.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4)",params![c["id"].as_str().unwrap(),c["documentId"].as_str().unwrap(),c["projectId"].as_str().unwrap(),serde_json::to_string(c).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?; }
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
    if !["started", "completed", "failed", "denied"].contains(&status.as_str()) { return Err("Invalid audit status.".into()); }
    let timestamp = event.get("timestamp").and_then(|v|v.as_f64()).filter(|v|v.is_finite()).ok_or("Invalid audit timestamp.")?;
    let detail = match event.get("detail") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => Some(v.as_str().filter(|s|s.len()<=1000).ok_or("Invalid audit detail.")?.to_string())
    };
    let tx=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
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
    let mut safe_event=event.clone();
    if let Some(object)=safe_event.as_object_mut() {
        if let Some(value)=&attributes { object.insert("attributes".into(),value.clone()); } else { object.remove("attributes"); }
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

    let api_key = credential_entry(&credential_handle)?
        .get_password()
        .map_err(|_| "Save an API key in the OS credential vault first.".to_string())?;
    if api_key.is_empty() || api_key.len() > 8192 {
        return Err("Stored provider credential is invalid.".into());
    }
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
    let mut response = client.post(endpoint)
        .bearer_auth(&api_key)
        .json(&payload)
        .send()
        .await
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
        let raw = String::from_utf8_lossy(&body).replace(&api_key, "[redacted]");
        let excerpt: String = raw.chars().take(500).collect();
        return Err(format!("Provider returned HTTP {status}: {excerpt}"));
    }
    let data: ChatCompletionResponse = serde_json::from_slice(&body)
        .map_err(|e| format!("Could not parse provider response: {e}"))?;
    data.choices.into_iter().next().map(|choice| choice.message.content)
        .ok_or_else(|| "Provider returned an empty response.".into())
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_app_version, send_chat, load_conversations, save_conversations, load_projects, save_project, delete_project, load_memories, save_memory, delete_memory, load_knowledge_chunks, save_knowledge_chunks, replace_knowledge_document, delete_knowledge_document, export_workspace, import_workspace, store_provider_key, provider_vault_status, has_provider_key, delete_provider_key, load_agent_checkpoint, list_agent_checkpoints, save_agent_checkpoint, delete_agent_checkpoint, record_tool_audit_event, list_tool_audit_events, append_trace_event, list_trace_events, write_clipboard, read_clipboard])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS AU");
}
#[cfg(test)]
mod database_tests {
    use super::*;
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
        let trace=serde_json::json!({"traceId":"trace-1","runId":"run-1","name":"agent.step","status":"completed","timestamp":13.0,"durationMs":5.0,"attributes":{"step":2,"apiKey":"must-not-persist","label":"safe"}});
        append_trace_event_record(&mut connection,trace).expect("append trace");
        let listed=list_trace_event_records(&connection,Some("run-1"),Some("trace-1"),10).expect("list trace");
        assert_eq!(listed.len(),1);
        assert_eq!(listed[0]["attributes"]["step"],2);
        assert_eq!(listed[0]["attributes"]["label"],"safe");
        assert!(listed[0]["attributes"].get("apiKey").is_none());
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
    fn upgrades_schema_version_four_atomically_to_six() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("create current schema");
        connection.pragma_update(None, "user_version", 4).expect("simulate v4");
        connection.execute_batch("DROP TABLE trace_events; DROP TABLE tool_audit_events; DROP TABLE agent_checkpoints;").expect("remove v5 and v6 tables");
        migrate_database(&mut connection).expect("upgrade v4 to v6");
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).expect("schema version");
        assert_eq!(version, 6);
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
        assert_eq!(version, 6);
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
