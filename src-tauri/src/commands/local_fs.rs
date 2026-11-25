use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::FileEntry;
use crate::protocols::sort_entries;

#[tauri::command]
pub fn get_default_local_dir() -> AppResult<String> {
    let dir = dirs::home_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("/"));
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn local_list_roots() -> AppResult<Vec<String>> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                roots.push(root);
            }
        }
        if roots.is_empty() {
            roots.push("C:\\".to_string());
        }
        Ok(roots)
    }
    #[cfg(not(windows))]
    {
        Ok(vec!["/".to_string()])
    }
}

#[tauri::command]
pub fn local_list_dir(path: String) -> AppResult<Vec<FileEntry>> {
    let trimmed = path.trim();
    #[cfg(windows)]
    let normalized = if trimmed.starts_with("//") {
        trimmed.replace('/', "\\")
    } else {
        trimmed.to_string()
    };
    #[cfg(not(windows))]
    let normalized = trimmed.to_string();

    let target = Path::new(&normalized);
    if !target.exists() {
        return Err(AppError::NotFound(format!("Local path not found: {normalized}")));
    }

    let read_dir = fs::read_dir(target)?;
    let mut entries = Vec::new();

    for entry_res in read_dir {
        let Ok(entry) = entry_res else { continue };
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let symlink_meta = fs::symlink_metadata(&entry_path).ok();
        let is_symlink = symlink_meta
            .as_ref()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let modified = meta.modified().ok().map(|st| {
            let dt: DateTime<Utc> = st.into();
            dt.to_rfc3339()
        });

        #[cfg(unix)]
        let (permissions, mode) = {
            use std::os::unix::fs::PermissionsExt;
            let m = meta.permissions().mode() & 0o7777;
            (
                Some(crate::protocols::format_posix_permissions(
                    m, is_dir, is_symlink,
                )),
                Some(m),
            )
        };
        #[cfg(not(unix))]
        let (permissions, mode) = (
            Some(if meta.permissions().readonly() {
                "r--".to_string()
            } else {
                "rw-".to_string()
            }),
            None,
        );

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
            size,
            modified,
            permissions,
            mode,
            owner: None,
        });
    }

    sort_entries(&mut entries);
    Ok(entries)
}

#[tauri::command]
pub fn local_mkdir(path: String) -> AppResult<()> {
    fs::create_dir_all(&path)?;
    Ok(())
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> AppResult<()> {
    fs::rename(&from, &to)?;
    Ok(())
}

fn validate_deletable_path(path: &str) -> AppResult<&Path> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Path cannot be empty".into()));
    }
    let normalized = trimmed.replace('\\', "/");
    let stripped = normalized.trim_end_matches('/');
    // Reject POSIX root "/", Windows drive roots "C:", "C:/", or UNC root "//server" / "//server/share"
    if stripped.is_empty() {
        return Err(AppError::Validation("Refusing to delete root path".into()));
    }
    if stripped.len() == 2 && stripped.as_bytes()[0].is_ascii_alphabetic() && stripped.as_bytes()[1] == b':' {
        return Err(AppError::Validation("Refusing to delete drive root".into()));
    }
    if normalized.starts_with("//") {
        let parts: Vec<&str> = normalized.trim_start_matches('/').split('/').filter(|s| !s.is_empty()).collect();
        if parts.len() <= 2 {
            return Err(AppError::Validation("Refusing to delete network share root".into()));
        }
    }
    Ok(Path::new(trimmed))
}

#[tauri::command]
pub fn local_delete(path: String, is_dir: bool) -> AppResult<()> {
    let target = validate_deletable_path(&path)?;
    if is_dir {
        fs::remove_dir_all(target)?;
    } else {
        fs::remove_file(target)?;
    }
    Ok(())
}

#[tauri::command]
pub fn local_stat(path: String) -> AppResult<FileEntry> {
    let target = Path::new(&path);
    let meta = fs::metadata(target)?;
    let is_dir = meta.is_dir();
    let modified = meta.modified().ok().map(|st| {
        let dt: DateTime<Utc> = st.into();
        dt.to_rfc3339()
    });
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    Ok(FileEntry {
        name,
        path,
        is_dir,
        is_symlink: false,
        size: if is_dir { 0 } else { meta.len() },
        modified,
        permissions: Some(if meta.permissions().readonly() {
            "r--".to_string()
        } else {
            "rw-".to_string()
        }),
        mode: None,
        owner: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_deletable_path_rejects_empty_and_roots() {
        for forbidden in ["", "   ", "/", "///", "C:", "C:\\", "C:/", "\\\\server\\share", "//server/share/"] {
            assert!(
                validate_deletable_path(forbidden).is_err(),
                "expected rejection for {forbidden:?}"
            );
        }
    }

    #[test]
    fn validate_deletable_path_accepts_regular_paths() {
        assert!(validate_deletable_path("/tmp/demo.txt").is_ok());
        assert!(validate_deletable_path("C:\\Users\\Carlos\\test.txt").is_ok());
        assert!(validate_deletable_path("\\\\server\\share\\folder").is_ok());
    }
}
