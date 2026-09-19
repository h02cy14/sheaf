//! SQLite connections for project index caches (ADR 0002).
//!
//! Each cache lives at `<app-local-data>/index/<project-id>.db`, outside the
//! project folder, so sync clients never see a database file. It's only a
//! cache: `destroy` deletes it and the next open rebuilds it from the files.

use crate::error::{CmdError, CmdResult};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde_json::{Map, Number, Value};
use std::path::{Path, PathBuf};

pub fn cache_path(index_dir: &Path, project_id: &str) -> CmdResult<PathBuf> {
    let valid = !project_id.is_empty()
        && project_id.len() <= 64
        && project_id.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(CmdError::new(
            "invalid-id",
            "Project ids are letters and digits only.",
        ));
    }
    Ok(index_dir.join(format!("{project_id}.db")))
}

pub fn open(path: &Path) -> CmdResult<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(2))?;
    // A cache: favour speed; losing the last transaction on power loss is fine.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

/// Deletes the cache database and its side files.
pub fn destroy(path: &Path) -> CmdResult<()> {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let file = PathBuf::from(format!("{}{suffix}", path.display()));
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
    }
}

pub fn execute(conn: &Connection, sql: &str, params: &[Value]) -> CmdResult<()> {
    conn.execute(sql, params_from_iter(params.iter().map(to_sql)))?;
    Ok(())
}

pub fn execute_many(conn: &mut Connection, sql: &str, rows: &[Vec<Value>]) -> CmdResult<()> {
    let tx = conn.transaction()?;
    {
        let mut statement = tx.prepare(sql)?;
        for row in rows {
            statement.execute(params_from_iter(row.iter().map(to_sql)))?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn query(conn: &Connection, sql: &str, params: &[Value]) -> CmdResult<Vec<Map<String, Value>>> {
    let mut statement = conn.prepare(sql)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut rows = statement.query(params_from_iter(params.iter().map(to_sql)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (i, name) in names.iter().enumerate() {
            object.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(object);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_values_through_sqlite() {
        let mut conn = Connection::open_in_memory().unwrap();
        execute(&conn, "CREATE TABLE t (a, b, c, d)", &[]).unwrap();
        execute_many(
            &mut conn,
            "INSERT INTO t VALUES (?, ?, ?, ?)",
            &[vec![json!(1), json!(2.5), json!("中文 text"), Value::Null]],
        )
        .unwrap();
        let rows = query(&conn, "SELECT a, b, c, d FROM t", &[]).unwrap();
        assert_eq!(
            Value::Object(rows[0].clone()),
            json!({ "a": 1, "b": 2.5, "c": "中文 text", "d": null })
        );
    }

    #[test]
    fn a_garbage_file_fails_on_first_use_and_can_be_destroyed() {
        let dir = std::env::temp_dir().join(format!("sheaf-index-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = cache_path(&dir, "01J9ZK3D7Q0W6Y8V4T2R5N1M0P").unwrap();
        std::fs::write(&path, "not a database ".repeat(100)).unwrap();
        let result = open(&path).and_then(|c| execute(&c, "CREATE TABLE IF NOT EXISTS x (a)", &[]));
        assert!(result.is_err());
        destroy(&path).unwrap();
        assert!(!path.exists());
        let conn = open(&path).unwrap();
        execute(&conn, "CREATE TABLE IF NOT EXISTS x (a)", &[]).unwrap();
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_ids_that_could_escape_the_index_folder() {
        let dir = Path::new("/tmp");
        for bad in ["", "../x", "a/b", "a.b", &"x".repeat(65)] {
            assert!(cache_path(dir, bad).is_err(), "{bad:?}");
        }
    }
}
