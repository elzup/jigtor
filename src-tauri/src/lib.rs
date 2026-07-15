use std::fs;
use std::path::Path;

// File IO for the frontend's File System Access seam. The web build talks to the
// browser's showDirectoryPicker/handle API; here the same seam is served by these
// commands (see src/tauri-fs.ts), which use std::fs directly and are therefore not
// bound by the fs-plugin path scope — the user picks the path via the OS dialog.
#[tauri::command]
fn fs_read(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    is_dir: bool,
}

// Lists a directory's immediate entries so the frontend can offer JSON config
// candidates (mirrors the browser FileSystemDirectoryHandle.values()).
#[tauri::command]
fn fs_list(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir,
        });
    }
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_read, fs_write, fs_exists, fs_mkdir, fs_list
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
