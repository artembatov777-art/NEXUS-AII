use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection};
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

struct AppDatabase(Mutex<Connection>);
fn migrate_database(connection: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        let transaction = connection.transaction()?;
        transaction.execute_batch("CREATE TABLE conversations (id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,project_id TEXT,updated_at INTEGER NOT NULL); CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at INTEGER NOT NULL,source_references TEXT); CREATE INDEX idx_conversations_project_updated ON conversations(project_id,updated_at DESC); CREATE INDEX idx_messages_conversation_created ON messages(conversation_id,created_at);")?;
        transaction.pragma_update(None, "user_version", 1)?;
        transaction.commit()?;
    }

    let current_version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current_version < 2 {
        let transaction = connection.transaction()?;
        transaction.execute_batch("CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,schema_version INTEGER NOT NULL); CREATE INDEX idx_projects_updated ON projects(updated_at DESC);")?;
        transaction.pragma_update(None, "user_version", 2)?;
        transaction.commit()?;
    }

    let current_version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current_version < 3 {
        let transaction = connection.transaction()?;
        transaction.execute_batch("CREATE TABLE memory_records (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, project_id TEXT, updated_at INTEGER NOT NULL, payload TEXT NOT NULL, CHECK(scope != 'project' OR project_id IS NOT NULL)); CREATE INDEX idx_memory_scope_project_updated ON memory_records(scope,project_id,updated_at DESC); CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, payload TEXT NOT NULL); CREATE INDEX idx_knowledge_project_document ON knowledge_chunks(project_id,document_id);")?;
        transaction.pragma_update(None, "user_version", 3)?;
        transaction.commit()?;
    }

    let current_version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current_version < 4 {
        let transaction = connection.transaction()?;
        transaction.execute_batch("CREATE TRIGGER validate_conversation_project_insert BEFORE INSERT ON conversations WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER validate_conversation_project_update BEFORE UPDATE OF project_id ON conversations WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER validate_memory_project_insert BEFORE INSERT ON memory_records WHEN NEW.scope='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER validate_memory_project_update BEFORE UPDATE OF project_id,scope ON memory_records WHEN NEW.scope='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Unknown project'); END; CREATE TRIGGER cleanup_project_data AFTER DELETE ON projects BEGIN DELETE FROM conversations WHERE project_id=OLD.id; DELETE FROM memory_records WHERE project_id=OLD.id; END;");
        transaction.pragma_update(None, "user_version", 4)?;
        transaction.commit()?;
    }
    Ok(())
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
    let id = record.get("id").and_then(|v| v.as_str()).ok_or("Memory ID is required.")?;
    let content = record.get("content").and_then(|v| v.as_str()).ok_or("Memory content is required.")?;
    let scope = record.get("scope").and_then(|v| v.as_str()).ok_or("Memory scope is required.")?;
    let project_id = record.get("projectId").and_then(|v| v.as_str());
    let updated_at = record.get("updatedAt").and_then(|v| v.as_i64()).ok_or("Memory timestamp is invalid.")?;
    if id.is_empty() || id.len() > 128 || content.is_empty() || content.len() > 4000 || !["profile","project","conversation"].contains(&scope) || (scope == "project" && project_id.is_none()) {
        return Err("Memory data is invalid or exceeds limits.".into());
    }
    let payload = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    connection.execute("INSERT INTO memory_records(id,scope,project_id,updated_at,payload) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,project_id=excluded.project_id,updated_at=excluded.updated_at,payload=excluded.payload", params![id,scope,project_id,updated_at,payload]).map_err(|e| e.to_string())?;
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
    if chunks.len() > 100000 { return Err("Knowledge base exceeds the chunk limit.".into()); }
    let mut ids = HashSet::new();
    for chunk in &chunks {
        let id = chunk.get("id").and_then(|v| v.as_str()).ok_or("Chunk ID is required.")?;
        let document_id = chunk.get("documentId").and_then(|v| v.as_str()).ok_or("Document ID is required.")?;
        let project_id = chunk.get("projectId").and_then(|v| v.as_str()).ok_or("Project ID is required.")?;
        let text = chunk.get("text").and_then(|v| v.as_str()).ok_or("Chunk text is required.")?;
        if id.is_empty() || id.len() > 160 || document_id.is_empty() || document_id.len() > 160 || project_id.is_empty() || project_id.len() > 128 || text.is_empty() || text.len() > 12000 || !ids.insert(id.to_string()) {
            return Err("Knowledge chunk is invalid, duplicated, or exceeds limits.".into());
        }
    }
    let mut connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction.execute("DELETE FROM knowledge_chunks", []).map_err(|e| e.to_string())?;
    for chunk in chunks {
        let id = chunk["id"].as_str().unwrap();
        let document_id = chunk["documentId"].as_str().unwrap();
        let project_id = chunk["projectId"].as_str().unwrap();
        let payload = serde_json::to_string(&chunk).map_err(|e| e.to_string())?;
        transaction.execute("INSERT INTO knowledge_chunks(id,document_id,project_id,payload) VALUES(?1,?2,?3,?4)", params![id,document_id,project_id,payload]).map_err(|e| e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())
}


fn credential_entry(handle: &str) -> Result<keyring::Entry, String> {
    if handle != "default" { return Err("Unknown credential handle.".into()); }
    keyring::Entry::new("com.nexusau.desktop", handle).map_err(|e| format!("OS credential store unavailable: {e}"))
}

#[tauri::command]
fn store_provider_key(api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() || api_key.len() > 8192 { return Err("API key is empty or exceeds the size limit.".into()); }
    credential_entry("default")?.set_password(api_key.trim()).map_err(|e| format!("Could not store API key in the OS credential vault: {e}"))
}

#[tauri::command]
fn has_provider_key() -> bool {
    credential_entry("default").and_then(|entry| entry.get_password().map(|_| ())).is_ok()
}

#[tauri::command]
fn delete_provider_key() -> Result<(), String> {
    match credential_entry("default")?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete API key from the OS credential vault: {e}"))
    }
}


#[tauri::command]
fn export_workspace(database: State<'_, AppDatabase>) -> Result<serde_json::Value, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
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
fn import_workspace(database: State<'_, AppDatabase>, backup: serde_json::Value) -> Result<(), String> {
    if backup.get("format").and_then(|v|v.as_str())!=Some("nexus-au-backup") || backup.get("schemaVersion").and_then(|v|v.as_i64())!=Some(1) { return Err("Unsupported or invalid NEXUS AU backup file.".into()); }
    let projects:Vec<StoredProject>=serde_json::from_value(backup.get("projects").cloned().ok_or("Backup projects are missing.")?).map_err(|e|e.to_string())?;
    let conversations:Vec<StoredConversation>=serde_json::from_value(backup.get("conversations").cloned().ok_or("Backup conversations are missing.")?).map_err(|e|e.to_string())?;
    let memories=backup.get("memories").and_then(|v|v.as_array()).ok_or("Backup memories are missing.")?;
    let chunks=backup.get("knowledgeChunks").and_then(|v|v.as_array()).ok_or("Backup knowledge chunks are missing.")?;
    if projects.len()>10000 || conversations.len()>10000 || memories.len()>10000 || chunks.len()>100000 { return Err("Backup exceeds import limits.".into()); }
    let project_ids:HashSet<&str>=projects.iter().map(|p|p.id.as_str()).collect();
    if project_ids.len()!=projects.len() || projects.iter().any(|p|p.id.is_empty()||p.id.len()>128||p.name.trim().is_empty()||p.name.len()>80||p.description.len()>500||p.schema_version!=1) { return Err("Backup contains invalid or duplicate projects.".into()); }
    let conversation_ids:HashSet<&str>=conversations.iter().map(|c|c.id.as_str()).collect();
    if conversation_ids.len()!=conversations.len() || conversations.iter().any(|c|c.id.is_empty()||c.id.len()>128||c.title.len()>120||c.messages.len()>20000||c.project_id.as_deref().map_or(false,|id|!project_ids.contains(id))) { return Err("Backup contains invalid or duplicate conversations.".into()); }
    for c in &conversations { for m in &c.messages { if m.id.is_empty()||m.id.len()>128||m.content.len()>100000||!["user","assistant"].contains(&m.role.as_str()) { return Err("Backup contains invalid messages.".into()); } } }
    for m in memories {
        let id=m.get("id").and_then(|v|v.as_str()).ok_or("Memory ID missing.")?;
        let content=m.get("content").and_then(|v|v.as_str()).ok_or("Memory content missing.")?;
        let scope=m.get("scope").and_then(|v|v.as_str()).ok_or("Memory scope missing.")?;
        let pid=m.get("projectId").and_then(|v|v.as_str());
        if id.is_empty()||id.len()>128||content.is_empty()||content.len()>4000||!["profile","project","conversation"].contains(&scope)||(scope=="project"&&pid.map_or(true,|p|!project_ids.contains(p))) { return Err("Backup contains invalid memories.".into()); }
    }
    for c in chunks {
        let id=c.get("id").and_then(|v|v.as_str()).ok_or("Chunk ID missing.")?;
        let doc=c.get("documentId").and_then(|v|v.as_str()).ok_or("Document ID missing.")?;
        let pid=c.get("projectId").and_then(|v|v.as_str()).ok_or("Chunk project missing.")?;
        let body=c.get("text").and_then(|v|v.as_str()).ok_or("Chunk text missing.")?;
        if id.is_empty()||id.len()>160||doc.is_empty()||doc.len()>160||!project_ids.contains(pid)||body.is_empty()||body.len()>12000 { return Err("Backup contains invalid knowledge chunks.".into()); }
    }
    let mut connection=database.0.lock().map_err(|_|"Database lock is unavailable.")?;
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
    let base = base_url.trim().trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://localhost") || base.starts_with("http://127.0.0.1")) {
        return Err("Provider URL must use HTTPS (HTTP is allowed only for localhost).".into());
    }
    let api_key = credential_entry(&credential_handle)?.get_password().map_err(|_| "Save an API key in the OS credential vault first.".to_string())?;
    if model.trim().is_empty() || messages.is_empty() {
        return Err("A model and at least one message are required.".into());
    }

    let endpoint = if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    };

    let payload = serde_json::json!({
        "model": model,
        "messages": messages.iter().map(|m| serde_json::json!({
            "role": m.role,
            "content": m.content
        })).collect::<Vec<_>>()
    });

    let response = reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(&api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Provider request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let excerpt: String = body.chars().take(500).collect();
        return Err(format!("Provider returned HTTP {status}: {excerpt}"));
    }

    let data: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not parse provider response: {e}"))?;

    data.choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
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
        .invoke_handler(tauri::generate_handler![get_app_version, send_chat, load_conversations, save_conversations, load_projects, save_project, delete_project, load_memories, save_memory, delete_memory, load_knowledge_chunks, save_knowledge_chunks, export_workspace, import_workspace, store_provider_key, has_provider_key, delete_provider_key])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS AU");
}
#[cfg(test)]
mod database_tests {
    use super::*;
    #[test]
    fn creates_versioned_schema_and_foreign_key_constraints() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        migrate_database(&mut connection).expect("apply initial migration");
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).expect("schema version");
        assert_eq!(version, 4);
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
