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
struct AppDatabase(Mutex<Connection>);
fn migrate_database(connection: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        let transaction = connection.transaction()?;
        transaction.execute_batch("CREATE TABLE conversations (id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,project_id TEXT,updated_at INTEGER NOT NULL); CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at INTEGER NOT NULL,source_references TEXT); CREATE INDEX idx_conversations_project_updated ON conversations(project_id,updated_at DESC); CREATE INDEX idx_messages_conversation_created ON messages(conversation_id,created_at);")?;
        transaction.pragma_update(None, "user_version", 1)?;
        transaction.commit()?;
    }
    Ok(())
}


#[tauri::command]
fn load_conversations(database: State<'_, AppDatabase>) -> Result<Vec<StoredConversation>, String> {
    let connection = database.0.lock().map_err(|_| "Database lock is unavailable.")?;
    let metadata = {
        let mut statement = connection.prepare("SELECT id,title,project_id,updated_at FROM conversations ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        statement.query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,i64>(3)?))).map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    let mut conversations = Vec::with_capacity(metadata.len());
    for (id,title,project_id,updated_at) in metadata {
        let messages = {
            let mut statement = connection.prepare("SELECT id,role,content,created_at,source_references FROM messages WHERE conversation_id=?1 ORDER BY created_at,rowid").map_err(|e| e.to_string())?;
            statement.query_map(params![id], |row| {
                let source_json: Option<String> = row.get(4)?;
                Ok(StoredMessage { id: row.get(0)?, role: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?, source_references: source_json.and_then(|json| serde_json::from_str(&json).ok()) })
            }).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
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
        statement.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    for id in existing {
        if !ids.contains(id.as_str()) {
            transaction.execute("DELETE FROM conversations WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        }
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
        .invoke_handler(tauri::generate_handler![get_app_version, send_chat])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS AU");
}