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

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
async fn send_chat(
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ProviderInputMessage>,
) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://localhost") || base.starts_with("http://127.0.0.1")) {
        return Err("Provider URL must use HTTPS (HTTP is allowed only for localhost).".into());
    }
    if api_key.trim().is_empty() {
        return Err("API key is required.".into());
    }
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
        .bearer_auth(api_key)
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
        .invoke_handler(tauri::generate_handler![get_app_version, send_chat, load_conversations, save_conversations, load_projects, save_project, delete_project, load_memories, save_memory, delete_memory, load_knowledge_chunks, save_knowledge_chunks])
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
        assert_eq!(version, 3);
        let project_table: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'", [], |row| row.get(0)).expect("projects table");
        assert_eq!(project_table, 1);
        let result = connection.execute("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES('m1','missing','user','test',1)", []);
        assert!(result.is_err(), "message must reference an existing conversation");
    }
}
