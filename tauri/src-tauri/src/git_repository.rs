use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct GitRepository {
    pub path: String,
    pub modified_count: usize,
    pub added_count: usize,
    pub deleted_count: usize,
    pub untracked_count: usize,
    pub current_branch: Option<String>,
    pub github_url: Option<String>,
}

impl GitRepository {
    pub fn new(path: String) -> Self {
        Self {
            path,
            modified_count: 0,
            added_count: 0,
            deleted_count: 0,
            untracked_count: 0,
            current_branch: None,
            github_url: None,
        }
    }

    pub fn has_changes(&self) -> bool {
        self.modified_count > 0
            || self.added_count > 0
            || self.deleted_count > 0
            || self.untracked_count > 0
    }

    pub fn total_changed_files(&self) -> usize {
        self.modified_count + self.added_count + self.deleted_count + self.untracked_count
    }

    pub fn folder_name(&self) -> &str {
        Path::new(&self.path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
    }

    pub fn status_text(&self) -> String {
        if !self.has_changes() {
            return "clean".to_string();
        }

        let mut parts = Vec::new();
        if self.modified_count > 0 {
            parts.push(format!("{}M", self.modified_count));
        }
        if self.added_count > 0 {
            parts.push(format!("{}A", self.added_count));
        }
        if self.deleted_count > 0 {
            parts.push(format!("{}D", self.deleted_count));
        }
        if self.untracked_count > 0 {
            parts.push(format!("{}U", self.untracked_count));
        }
        parts.join(" ")
    }

    /// Extract GitHub URL from a repository path
    pub fn get_github_url(repo_path: &str) -> Option<String> {
        let output = Command::new("git")
            .args(&["remote", "get-url", "origin"])
            .current_dir(repo_path)
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let remote_url = String::from_utf8(output.stdout)
            .ok()?
            .trim()
            .to_string();

        Self::parse_github_url(&remote_url)
    }

    /// Parse GitHub URL from git remote output
    fn parse_github_url(remote_url: &str) -> Option<String> {
        // Handle HTTPS URLs: https://github.com/user/repo.git
        if remote_url.starts_with("https://github.com/") {
            let clean_url = if remote_url.ends_with(".git") {
                &remote_url[..remote_url.len() - 4]
            } else {
                remote_url
            };
            return Some(clean_url.to_string());
        }

        // Handle SSH URLs: git@github.com:user/repo.git
        if remote_url.starts_with("git@github.com:") {
            let path_part = &remote_url["git@github.com:".len()..];
            let clean_path = if path_part.ends_with(".git") {
                &path_part[..path_part.len() - 4]
            } else {
                path_part
            };
            return Some(format!("https://github.com/{}", clean_path));
        }

        None
    }
}