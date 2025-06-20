use axum::{
    extract::{Path, Query, State as AxumState},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncReadExt;

#[derive(Debug, Deserialize)]
pub struct FileQuery {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub readonly: bool,
    pub hidden: bool,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub accessed: Option<String>,
    #[cfg(unix)]
    pub permissions: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveRequest {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
pub struct CopyRequest {
    pub from: String,
    pub to: String,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
    pub encoding: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OperationResult {
    pub success: bool,
    pub message: String,
}

/// Expand tilde to home directory
fn expand_path(path: &str) -> Result<PathBuf, StatusCode> {
    if path.starts_with('~') {
        let home = dirs::home_dir()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(home.join(path.strip_prefix("~/").unwrap_or("")))
    } else {
        Ok(PathBuf::from(path))
    }
}

/// Get detailed file metadata
pub async fn get_file_info(
    Query(params): Query<FileQuery>,
) -> Result<Json<FileMetadata>, StatusCode> {
    let path = expand_path(&params.path)?;
    
    let metadata = fs::metadata(&path).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    
    let name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    
    let is_symlink = fs::symlink_metadata(&path).await
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    
    let hidden = name.starts_with('.');
    
    let created = metadata.created()
        .map(|t| {
            let datetime: chrono::DateTime<chrono::Utc> = t.into();
            datetime.to_rfc3339()
        })
        .ok();
    
    let modified = metadata.modified()
        .map(|t| {
            let datetime: chrono::DateTime<chrono::Utc> = t.into();
            datetime.to_rfc3339()
        })
        .ok();
    
    let accessed = metadata.accessed()
        .map(|t| {
            let datetime: chrono::DateTime<chrono::Utc> = t.into();
            datetime.to_rfc3339()
        })
        .ok();
    
    #[cfg(unix)]
    let permissions = {
        use std::os::unix::fs::PermissionsExt;
        Some(format!("{:o}", metadata.permissions().mode() & 0o777))
    };
    
    let mime_type = if metadata.is_file() {
        // Simple MIME type detection based on extension
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        
        Some(match ext {
            "txt" => "text/plain",
            "html" | "htm" => "text/html",
            "css" => "text/css",
            "js" => "application/javascript",
            "json" => "application/json",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "pdf" => "application/pdf",
            "zip" => "application/zip",
            _ => "application/octet-stream",
        }.to_string())
    } else {
        None
    };
    
    Ok(Json(FileMetadata {
        name,
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symlink,
        readonly: metadata.permissions().readonly(),
        hidden,
        created,
        modified,
        accessed,
        #[cfg(unix)]
        permissions,
        #[cfg(not(unix))]
        permissions: None,
        mime_type,
    }))
}

/// Read file contents
pub async fn read_file(
    Query(params): Query<FileQuery>,
) -> Result<Response, StatusCode> {
    let path = expand_path(&params.path)?;
    
    // Check if file exists and is a file
    let metadata = fs::metadata(&path).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    
    if !metadata.is_file() {
        return Err(StatusCode::BAD_REQUEST);
    }
    
    // Read file contents
    let mut file = fs::File::open(&path).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let mut contents = Vec::new();
    file.read_to_end(&mut contents).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    // Determine content type
    let content_type = path.extension()
        .and_then(|e| e.to_str())
        .and_then(|ext| match ext {
            "txt" => Some("text/plain"),
            "html" | "htm" => Some("text/html"),
            "css" => Some("text/css"),
            "js" => Some("application/javascript"),
            "json" => Some("application/json"),
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "gif" => Some("image/gif"),
            "pdf" => Some("application/pdf"),
            _ => None,
        })
        .unwrap_or("application/octet-stream");
    
    Ok((
        [(header::CONTENT_TYPE, content_type)],
        contents,
    ).into_response())
}

/// Write file contents
pub async fn write_file(
    Json(req): Json<WriteFileRequest>,
) -> Result<Json<OperationResult>, StatusCode> {
    let path = expand_path(&req.path)?;
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    
    // Write file
    let content = if req.encoding.as_deref() == Some("base64") {
        base64::decode(&req.content)
            .map_err(|_| StatusCode::BAD_REQUEST)?
    } else {
        req.content.into_bytes()
    };
    
    fs::write(&path, content).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(OperationResult {
        success: true,
        message: format!("File written successfully: {}", path.display()),
    }))
}

/// Delete file or directory
pub async fn delete_file(
    Query(params): Query<FileQuery>,
) -> Result<Json<OperationResult>, StatusCode> {
    let path = expand_path(&params.path)?;
    
    // Check if path exists
    let metadata = fs::metadata(&path).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    
    // Delete based on type
    if metadata.is_dir() {
        fs::remove_dir_all(&path).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        fs::remove_file(&path).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    
    Ok(Json(OperationResult {
        success: true,
        message: format!("Deleted: {}", path.display()),
    }))
}

/// Move/rename file or directory
pub async fn move_file(
    Json(req): Json<MoveRequest>,
) -> Result<Json<OperationResult>, StatusCode> {
    let from_path = expand_path(&req.from)?;
    let to_path = expand_path(&req.to)?;
    
    // Check if source exists
    if !from_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    
    // Check if destination already exists
    if to_path.exists() {
        return Err(StatusCode::CONFLICT);
    }
    
    // Ensure destination parent directory exists
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    
    // Move the file/directory
    fs::rename(&from_path, &to_path).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(OperationResult {
        success: true,
        message: format!("Moved from {} to {}", from_path.display(), to_path.display()),
    }))
}

/// Copy file or directory
pub async fn copy_file(
    Json(req): Json<CopyRequest>,
) -> Result<Json<OperationResult>, StatusCode> {
    let from_path = expand_path(&req.from)?;
    let to_path = expand_path(&req.to)?;
    
    // Check if source exists
    let metadata = fs::metadata(&from_path).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    
    // Check if destination already exists
    if to_path.exists() && !req.overwrite.unwrap_or(false) {
        return Err(StatusCode::CONFLICT);
    }
    
    // Ensure destination parent directory exists
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    
    // Copy based on type
    if metadata.is_file() {
        fs::copy(&from_path, &to_path).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else if metadata.is_dir() {
        // Recursive directory copy
        copy_dir_recursive(&from_path, &to_path).await?;
    }
    
    Ok(Json(OperationResult {
        success: true,
        message: format!("Copied from {} to {}", from_path.display(), to_path.display()),
    }))
}

/// Recursively copy a directory
async fn copy_dir_recursive(from: &PathBuf, to: &PathBuf) -> Result<(), StatusCode> {
    fs::create_dir_all(to).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let mut entries = fs::read_dir(from).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    while let Some(entry) = entries.next_entry().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        
        let from_path = entry.path();
        let to_path = to.join(entry.file_name());
        
        let metadata = entry.metadata().await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        if metadata.is_file() {
            fs::copy(&from_path, &to_path).await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        } else if metadata.is_dir() {
            Box::pin(copy_dir_recursive(&from_path, &to_path)).await?;
        }
    }
    
    Ok(())
}

/// Search for files matching a pattern
#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub path: String,
    pub pattern: String,
    pub max_depth: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

pub async fn search_files(
    Query(params): Query<SearchQuery>,
) -> Result<Json<Vec<SearchResult>>, StatusCode> {
    let base_path = expand_path(&params.path)?;
    let pattern = params.pattern.to_lowercase();
    let max_depth = params.max_depth.unwrap_or(5);
    
    let mut results = Vec::new();
    search_recursive(&base_path, &pattern, 0, max_depth, &mut results).await?;
    
    Ok(Json(results))
}

async fn search_recursive(
    path: &PathBuf,
    pattern: &str,
    depth: u32,
    max_depth: u32,
    results: &mut Vec<SearchResult>,
) -> Result<(), StatusCode> {
    if depth > max_depth {
        return Ok(());
    }
    
    let mut entries = fs::read_dir(path).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    while let Some(entry) = entries.next_entry().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        if file_name.to_lowercase().contains(pattern) {
            let metadata = entry.metadata().await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            
            results.push(SearchResult {
                path: entry_path.to_string_lossy().to_string(),
                name: file_name,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
            });
        }
        
        // Recurse into directories
        if entry.file_type().await
            .map(|t| t.is_dir())
            .unwrap_or(false) {
            Box::pin(search_recursive(&entry_path, pattern, depth + 1, max_depth, results)).await?;
        }
    }
    
    Ok(())
}