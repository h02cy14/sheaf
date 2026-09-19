//! Durable file operations inside one project folder.
//!
//! Every write is atomic: temp file in the same folder → flush to disk →
//! rename over the target → (Unix) flush the folder entry. A crash or power
//! loss leaves the old file or the new one, never a torn mix (ADR 0002).
//!
//! Paths come from the frontend as project-relative strings with `/`
//! separators and are validated before use: no absolute paths, no `..`, no
//! drive prefixes. The only deletion this module can perform is of its own
//! leftover temp files.

use crate::error::{CmdError, CmdResult};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub mtime_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: f64,
}

/// Joins a project-relative path onto `root`, rejecting anything that could
/// escape the folder. `""` means the root itself.
pub fn resolve(root: &Path, rel: &str) -> CmdResult<PathBuf> {
    let mut out = root.to_path_buf();
    if rel.is_empty() {
        return Ok(out);
    }
    if rel.contains('\\') || rel.contains('\0') || rel.contains(':') {
        return Err(CmdError::invalid_path(rel));
    }
    for part in rel.split('/') {
        let mut components = Path::new(part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => out.push(name),
            _ => return Err(CmdError::invalid_path(rel)),
        }
    }
    Ok(out)
}

fn stat_of(meta: &fs::Metadata) -> FileStat {
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    FileStat {
        size: meta.len(),
        mtime_ms,
    }
}

pub fn read_text(path: &Path) -> CmdResult<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn stat(path: &Path) -> CmdResult<Option<FileStat>> {
    match fs::metadata(path) {
        Ok(meta) if meta.is_file() => Ok(Some(stat_of(&meta))),
        Ok(_) => Ok(None),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn list(dir: &Path) -> CmdResult<Vec<DirEntry>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Ok(meta) = entry.metadata() else { continue };
        let stat = stat_of(&meta);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: stat.size,
            mtime_ms: stat.mtime_ms,
        });
    }
    Ok(out)
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_path_for(target: &Path) -> io::Result<PathBuf> {
    let dir = target.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "target has no parent folder")
    })?;
    let name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?
        .to_string_lossy();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(dir.join(format!(".{name}.{}-{n}-{nanos}.tmp", std::process::id())))
}

/// Windows lets antivirus, indexers and sync clients hold a file open
/// briefly; replacing it then fails with "access denied". Retry a few times.
fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut delay = Duration::from_millis(10);
    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied && attempt < 7 => {
                std::thread::sleep(delay);
                delay *= 2;
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    // Persist the rename itself. Best effort: some filesystems refuse.
    if let Ok(handle) = fs::File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

pub fn write_atomic(target: &Path, bytes: &[u8]) -> CmdResult<FileStat> {
    let temp = temp_path_for(target)?;
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        rename_with_retry(&temp, target)?;
        if let Some(dir) = target.parent() {
            sync_dir(dir);
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(stat_of(&fs::metadata(target)?))
}

pub fn mkdir(dir: &Path) -> CmdResult<()> {
    fs::create_dir_all(dir)?;
    Ok(())
}

pub fn rename(from: &Path, to: &Path) -> CmdResult<()> {
    if to.exists() {
        return Err(CmdError::new(
            "already-exists",
            "Refusing to replace an existing file by rename.",
        ));
    }
    rename_with_retry(from, to)?;
    Ok(())
}

/// Removes a leftover `.<name>.<suffix>.tmp` file. Refuses anything else:
/// Sheaf never deletes user files.
pub fn remove_temp(path: &Path) -> CmdResult<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !(name.starts_with('.') && name.ends_with(".tmp")) || !path.is_file() {
        return Err(CmdError::new(
            "refused",
            format!("Refusing to delete {name:?}: not a temporary file."),
        ));
    }
    fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sheaf-storage-test-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_accepts_plain_relative_paths() {
        let root = Path::new("/projects/novel");
        assert_eq!(resolve(root, "").unwrap(), root);
        assert_eq!(
            resolve(root, "docs/01J9.md").unwrap(),
            root.join("docs").join("01J9.md")
        );
    }

    #[test]
    fn resolve_rejects_escapes() {
        let root = Path::new("/projects/novel");
        for bad in [
            "../x",
            "docs/../../x",
            "/etc/passwd",
            "C:/x",
            "docs\\x",
            "docs//x",
            "./x",
            "docs/.",
            "a\0b",
        ] {
            assert!(resolve(root, bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = temp_dir();
        let target = dir.join("doc.md");
        write_atomic(&target, "first".as_bytes()).unwrap();
        let stat = write_atomic(&target, "second, longer".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second, longer");
        assert_eq!(stat.size, "second, longer".len() as u64);
        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["doc.md".to_string()]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_crashed_write_leaves_the_old_file_intact() {
        // Simulate a crash after the temp file was written but before rename.
        let dir = temp_dir();
        let target = dir.join("doc.md");
        write_atomic(&target, "safe".as_bytes()).unwrap();
        let temp = temp_path_for(&target).unwrap();
        fs::write(&temp, "half-writ").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "safe");
        // …and the leftover can be cleaned up, but nothing else can be deleted.
        remove_temp(&temp).unwrap();
        assert!(remove_temp(&target).is_err());
        assert!(target.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reading_missing_files_is_not_an_error() {
        let dir = temp_dir();
        assert_eq!(read_text(&dir.join("nope.md")).unwrap(), None);
        assert_eq!(stat(&dir.join("nope.md")).unwrap(), None);
        assert!(list(&dir.join("missing")).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_never_overwrites() {
        let dir = temp_dir();
        write_atomic(&dir.join("a.md"), b"a").unwrap();
        write_atomic(&dir.join("b.md"), b"b").unwrap();
        assert!(rename(&dir.join("a.md"), &dir.join("b.md")).is_err());
        assert_eq!(fs::read_to_string(dir.join("b.md")).unwrap(), "b");
        fs::remove_dir_all(dir).unwrap();
    }
}
