use rusqlite::{params, params_from_iter, ToSql};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::db::DbState;

#[derive(Debug, Serialize)]
struct HistoryItem {
    id: i64,
    account_id: String,
    database_id: String,
    session_id: String,
    execution_source: String,
    table_name: Option<String>,
    query_text: String,
    rows_read: i64,
    result_data: Option<String>,
    timestamp: String,
}

fn lock_conn<'a>(
    state: &'a State<'_, DbState>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Query history database lock is poisoned.".to_string())
}

#[tauri::command]
pub async fn save_query_history(
    state: State<'_, DbState>,
    account_id: String,
    database_id: String,
    session_id: String,
    execution_source: String,
    table_name: Option<String>,
    query_text: String,
    rows_read: Option<i64>,
    result_data: Option<String>,
) -> Result<Value, String> {
    let conn = lock_conn(&state)?;
    conn.execute(
        "INSERT INTO query_history (
            account_id,
            database_id,
            session_id,
            execution_source,
            table_name,
            query_text,
            rows_read,
            result_data
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            account_id,
            database_id,
            session_id,
            execution_source,
            table_name,
            query_text,
            rows_read.unwrap_or(0),
            result_data
        ],
    )
    .map_err(|err| err.to_string())?;

    Ok(json!({ "id": conn.last_insert_rowid() }))
}

#[tauri::command]
pub async fn get_paginated_history(
    state: State<'_, DbState>,
    page: Option<u32>,
    page_size: Option<u32>,
    account_id: Option<String>,
    database_id: Option<String>,
    session_id: Option<String>,
    search: Option<String>,
) -> Result<Value, String> {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(50).clamp(1, 200);
    let offset = ((page - 1) * page_size) as i64;
    let limit = page_size as i64;

    let mut where_clauses = Vec::new();
    let mut values: Vec<String> = Vec::new();

    if let Some(value) = account_id.filter(|value| !value.trim().is_empty()) {
        where_clauses.push("account_id = ?");
        values.push(value);
    }
    if let Some(value) = database_id.filter(|value| !value.trim().is_empty()) {
        where_clauses.push("database_id = ?");
        values.push(value);
    }
    if let Some(value) = session_id.filter(|value| !value.trim().is_empty()) {
        where_clauses.push("session_id = ?");
        values.push(value);
    }
    if let Some(value) = search.filter(|value| !value.trim().is_empty()) {
        where_clauses.push("(query_text LIKE ? OR COALESCE(table_name, '') LIKE ?)");
        let pattern = format!("%{}%", value.trim());
        values.push(pattern.clone());
        values.push(pattern);
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let conn = lock_conn(&state)?;
    let count_sql = format!("SELECT COUNT(*) FROM query_history{where_sql}");
    let total: i64 = {
        let params: Vec<&dyn ToSql> = values.iter().map(|value| value as &dyn ToSql).collect();
        conn.query_row(&count_sql, params_from_iter(params), |row| row.get(0))
            .map_err(|err| err.to_string())?
    };

    let data_sql = format!(
        "SELECT
            id,
            account_id,
            database_id,
            session_id,
            execution_source,
            table_name,
            query_text,
            rows_read,
            result_data,
            timestamp
        FROM query_history{where_sql}
        ORDER BY timestamp DESC, id DESC
        LIMIT ? OFFSET ?"
    );
    let mut data_values = values;
    data_values.push(limit.to_string());
    data_values.push(offset.to_string());
    let params: Vec<&dyn ToSql> = data_values
        .iter()
        .map(|value| value as &dyn ToSql)
        .collect();
    let mut stmt = conn.prepare(&data_sql).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                account_id: row.get(1)?,
                database_id: row.get(2)?,
                session_id: row.get(3)?,
                execution_source: row.get(4)?,
                table_name: row.get(5)?,
                query_text: row.get(6)?,
                rows_read: row.get(7)?,
                result_data: row.get(8)?,
                timestamp: row.get(9)?,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|err| err.to_string())?);
    }

    Ok(json!({
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size
    }))
}

#[tauri::command]
pub async fn get_global_stats(state: State<'_, DbState>) -> Result<Value, String> {
    let conn = lock_conn(&state)?;
    let total_queries: i64 = conn
        .query_row("SELECT COUNT(*) FROM query_history", [], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    let unique_databases: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT database_id) FROM query_history",
            [],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    let total_rows_read: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(rows_read), 0) FROM query_history",
            [],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    let latest_query: Option<String> = conn
        .query_row(
            "SELECT timestamp FROM query_history ORDER BY timestamp DESC, id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(json!({
        "totalQueries": total_queries,
        "uniqueDatabases": unique_databases,
        "totalRowsRead": total_rows_read,
        "latestQuery": latest_query
    }))
}

#[tauri::command]
pub async fn clear_query_history(
    state: State<'_, DbState>,
    account_id: Option<String>,
    database_id: Option<String>,
) -> Result<(), String> {
    let conn = lock_conn(&state)?;
    match (account_id, database_id) {
        (Some(account), Some(database)) => conn.execute(
            "DELETE FROM query_history WHERE account_id = ?1 AND database_id = ?2",
            params![account, database],
        ),
        (Some(account), None) => conn.execute(
            "DELETE FROM query_history WHERE account_id = ?1",
            params![account],
        ),
        (None, Some(database)) => conn.execute(
            "DELETE FROM query_history WHERE database_id = ?1",
            params![database],
        ),
        (None, None) => conn.execute("DELETE FROM query_history", []),
    }
    .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_history_debug_status(state: State<'_, DbState>) -> Result<Value, String> {
    let conn = lock_conn(&state)?;
    let table_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'query_history'",
            [],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    Ok(json!({
        "available": table_exists > 0,
        "table": "query_history"
    }))
}
