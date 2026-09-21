//! Native side of Sheaf. Shared by all five targets: desktop links this as an
//! rlib from `main.rs`; Android and iOS load it through `mobile_entry_point`.
//!
//! The frontend reaches the disk only through these commands, and only inside
//! a project folder it has attached (see `storage.rs`). Blocking I/O runs on
//! the blocking thread pool so the UI never waits on the disk.

mod error;
mod grammar;
mod index_db;
mod languagetool;
mod storage;

use error::{CmdError, CmdResult};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Manager, State};

/// Basic facts about the running build. Mirrored by `AppInfo` in
/// `src/platform/index.ts`; keep the two in sync.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    tauri_version: &'static str,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        tauri_version: tauri::VERSION,
    }
}

// ----------------------------------------------------------------- state

struct IndexHandle {
    path: PathBuf,
    conn: Mutex<rusqlite::Connection>,
}

/// Open project folders and index databases, addressed by small integer handles.
#[derive(Default)]
struct Registry {
    next: AtomicU32,
    projects: Mutex<HashMap<u32, Arc<PathBuf>>>,
    indexes: Mutex<HashMap<u32, Arc<IndexHandle>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> CmdResult<MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| CmdError::new("internal", "Internal state lock was poisoned."))
}

impl Registry {
    fn next_id(&self) -> u32 {
        self.next.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn project(&self, handle: u32) -> CmdResult<Arc<PathBuf>> {
        lock(&self.projects)?
            .get(&handle)
            .cloned()
            .ok_or_else(CmdError::unknown_handle)
    }

    fn index(&self, handle: u32) -> CmdResult<Arc<IndexHandle>> {
        lock(&self.indexes)?
            .get(&handle)
            .cloned()
            .ok_or_else(CmdError::unknown_handle)
    }
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| CmdError::new("internal", e.to_string()))?
}

// ------------------------------------------------------ project folders

/// Where new projects go: `Documents/Sheaf` on desktop, app storage on mobile.
/// `SHEAF_PROJECTS_DIR` overrides it (used by automated tests).
fn default_projects_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    if let Some(dir) = std::env::var_os("SHEAF_PROJECTS_DIR") {
        return Ok(PathBuf::from(dir));
    }
    #[cfg(desktop)]
    if let Ok(documents) = app.path().document_dir() {
        return Ok(documents.join("Sheaf"));
    }
    Ok(app.path().app_data_dir()?.join("Projects"))
}

fn index_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_local_data_dir()?.join("index"))
}

/// A folder name that is valid on every platform we ship to.
fn folder_name(title: &str) -> String {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed: String = cleaned
        .trim()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(80)
        .collect();
    let trimmed = trimmed.trim().to_string();
    if trimmed.is_empty() || RESERVED.contains(&trimmed.to_uppercase().as_str()) {
        "Untitled".to_string()
    } else {
        trimmed
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEntry {
    root: String,
    name: String,
    modified_ms: f64,
}

#[tauri::command]
async fn projects_dir(app: AppHandle) -> CmdResult<String> {
    let dir = default_projects_dir(&app)?;
    blocking(move || {
        storage::mkdir(&dir)?;
        Ok(dir.to_string_lossy().into_owned())
    })
    .await
}

/// Project folders directly inside the default projects directory.
#[tauri::command]
async fn projects_list(app: AppHandle) -> CmdResult<Vec<ProjectEntry>> {
    let dir = default_projects_dir(&app)?;
    blocking(move || {
        let mut out = Vec::new();
        for entry in storage::list(&dir)? {
            if !entry.is_dir {
                continue;
            }
            let root = dir.join(&entry.name);
            if let Some(stat) = storage::stat(&root.join("project.json"))? {
                out.push(ProjectEntry {
                    root: root.to_string_lossy().into_owned(),
                    name: entry.name,
                    modified_ms: stat.mtime_ms,
                });
            }
        }
        Ok(out)
    })
    .await
}

/// Creates a new, empty, uniquely named project folder and returns its path.
#[tauri::command]
async fn project_create_folder(app: AppHandle, title: String) -> CmdResult<String> {
    let dir = default_projects_dir(&app)?;
    blocking(move || {
        storage::mkdir(&dir)?;
        let base = folder_name(&title);
        for n in 1..1000 {
            let name = if n == 1 {
                format!("{base}.sheaf")
            } else {
                format!("{base} {n}.sheaf")
            };
            let path = dir.join(name);
            match std::fs::create_dir(&path) {
                Ok(()) => return Ok(path.to_string_lossy().into_owned()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        Err(CmdError::new(
            "already-exists",
            "Too many projects with this name.",
        ))
    })
    .await
}

#[tauri::command]
async fn project_attach(registry: State<'_, Registry>, root: String) -> CmdResult<u32> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(CmdError::new(
            "not-found",
            format!("No such folder: {root}"),
        ));
    }
    let handle = registry.next_id();
    lock(&registry.projects)?.insert(handle, Arc::new(path));
    Ok(handle)
}

#[tauri::command]
async fn project_detach(registry: State<'_, Registry>, handle: u32) -> CmdResult<()> {
    lock(&registry.projects)?.remove(&handle);
    Ok(())
}

// --------------------------------------------------- files in a project

#[tauri::command]
async fn fs_read_text(
    registry: State<'_, Registry>,
    handle: u32,
    path: String,
) -> CmdResult<Option<String>> {
    let root = registry.project(handle)?;
    blocking(move || storage::read_text(&storage::resolve(&root, &path)?)).await
}

#[tauri::command]
async fn fs_write_text(
    registry: State<'_, Registry>,
    handle: u32,
    path: String,
    text: String,
) -> CmdResult<storage::FileStat> {
    let root = registry.project(handle)?;
    blocking(move || storage::write_atomic(&storage::resolve(&root, &path)?, text.as_bytes())).await
}

#[tauri::command]
async fn fs_stat(
    registry: State<'_, Registry>,
    handle: u32,
    path: String,
) -> CmdResult<Option<storage::FileStat>> {
    let root = registry.project(handle)?;
    blocking(move || storage::stat(&storage::resolve(&root, &path)?)).await
}

#[tauri::command]
async fn fs_list(
    registry: State<'_, Registry>,
    handle: u32,
    path: String,
) -> CmdResult<Vec<storage::DirEntry>> {
    let root = registry.project(handle)?;
    blocking(move || storage::list(&storage::resolve(&root, &path)?)).await
}

#[tauri::command]
async fn fs_mkdir(registry: State<'_, Registry>, handle: u32, path: String) -> CmdResult<()> {
    let root = registry.project(handle)?;
    blocking(move || storage::mkdir(&storage::resolve(&root, &path)?)).await
}

#[tauri::command]
async fn fs_rename(
    registry: State<'_, Registry>,
    handle: u32,
    from: String,
    to: String,
) -> CmdResult<()> {
    let root = registry.project(handle)?;
    blocking(move || {
        storage::rename(
            &storage::resolve(&root, &from)?,
            &storage::resolve(&root, &to)?,
        )
    })
    .await
}

#[tauri::command]
async fn fs_remove_temp(registry: State<'_, Registry>, handle: u32, path: String) -> CmdResult<()> {
    let root = registry.project(handle)?;
    blocking(move || storage::remove_temp(&storage::resolve(&root, &path)?)).await
}

// ------------------------------------------------------- index databases

#[tauri::command]
async fn index_open(
    app: AppHandle,
    registry: State<'_, Registry>,
    project_id: String,
) -> CmdResult<u32> {
    let path = index_db::cache_path(&index_dir(&app)?, &project_id)?;
    let opened = blocking(move || {
        let conn = index_db::open(&path)?;
        Ok(IndexHandle {
            path,
            conn: Mutex::new(conn),
        })
    })
    .await?;
    let handle = registry.next_id();
    lock(&registry.indexes)?.insert(handle, Arc::new(opened));
    Ok(handle)
}

/// Closes every connection to a project's cache and deletes it.
#[tauri::command]
async fn index_destroy(
    app: AppHandle,
    registry: State<'_, Registry>,
    project_id: String,
) -> CmdResult<()> {
    let path = index_db::cache_path(&index_dir(&app)?, &project_id)?;
    lock(&registry.indexes)?.retain(|_, index| index.path != path);
    blocking(move || index_db::destroy(&path)).await
}

#[tauri::command]
async fn db_execute(
    registry: State<'_, Registry>,
    db: u32,
    sql: String,
    params: Vec<Value>,
) -> CmdResult<()> {
    let index = registry.index(db)?;
    blocking(move || index_db::execute(&*lock(&index.conn)?, &sql, &params)).await
}

#[tauri::command]
async fn db_execute_many(
    registry: State<'_, Registry>,
    db: u32,
    sql: String,
    rows: Vec<Vec<Value>>,
) -> CmdResult<()> {
    let index = registry.index(db)?;
    blocking(move || index_db::execute_many(&mut *lock(&index.conn)?, &sql, &rows)).await
}

#[tauri::command]
async fn db_query(
    registry: State<'_, Registry>,
    db: u32,
    sql: String,
    params: Vec<Value>,
) -> CmdResult<Vec<Map<String, Value>>> {
    let index = registry.index(db)?;
    blocking(move || index_db::query(&*lock(&index.conn)?, &sql, &params)).await
}

#[tauri::command]
async fn db_close(registry: State<'_, Registry>, db: u32) -> CmdResult<()> {
    lock(&registry.indexes)?.remove(&db);
    Ok(())
}

// ---------------------------------------------------------------- grammar

/// Checks a paragraph of English. The frontend decides *whether* a paragraph
/// should be checked at all (see `@sheaf/core`'s language policy); this
/// command only answers for text that policy has already cleared, and it
/// never touches the network.
#[tauri::command]
async fn grammar_check(
    text: String,
    dialect: String,
    dictionary: Vec<String>,
) -> CmdResult<Vec<grammar::GrammarLint>> {
    blocking(move || grammar::check(&text, &dialect, &dictionary)).await
}

/// Sends one paragraph to a LanguageTool server the writer configured. Only
/// reached when the frontend's policy says this language has no offline
/// engine and an endpoint exists; plain http only (see `languagetool.rs`).
#[tauri::command]
async fn languagetool_check(
    endpoint: String,
    text: String,
    language: String,
) -> CmdResult<Vec<grammar::GrammarLint>> {
    blocking(move || languagetool::check(&endpoint, &text, &language)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Registry::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            projects_dir,
            projects_list,
            project_create_folder,
            project_attach,
            project_detach,
            fs_read_text,
            fs_write_text,
            fs_stat,
            fs_list,
            fs_mkdir,
            fs_rename,
            fs_remove_temp,
            index_open,
            index_destroy,
            db_execute,
            db_execute_many,
            db_query,
            db_close,
            grammar_check,
            languagetool_check,
        ])
        .run(tauri::generate_context!())
        .expect("Sheaf failed to start");
}

#[cfg(test)]
mod tests {
    use super::folder_name;

    #[test]
    fn folder_names_are_safe_everywhere() {
        assert_eq!(folder_name("My Novel"), "My Novel");
        // A full-width colon is a legal filename character everywhere; keep it.
        assert_eq!(folder_name("第一部：海"), "第一部：海");
        assert_eq!(folder_name("Part: One"), "Part  One");
        assert_eq!(folder_name("a/b\\c?"), "a b c");
        assert_eq!(folder_name("  ends with dots... "), "ends with dots");
        assert_eq!(folder_name("CON"), "Untitled");
        assert_eq!(folder_name(""), "Untitled");
        assert_eq!(folder_name(&"x".repeat(200)).chars().count(), 80);
    }
}
