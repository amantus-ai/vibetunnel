use crate::git_repository::GitRepository;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio::time::interval;

pub struct GitMonitor {
    // Cache for repository information by repository path
    repository_cache: Arc<RwLock<HashMap<String, GitRepository>>>,
    // Cache mapping file paths to their repository paths
    file_to_repo_cache: Arc<RwLock<HashMap<String, String>>>,
    // Cache for GitHub URLs by repository path
    github_url_cache: Arc<RwLock<HashMap<String, String>>>,
    // Track in-progress GitHub URL fetches
    github_url_fetches: Arc<Mutex<std::collections::HashSet<String>>>,
}

impl GitMonitor {
    pub fn new() -> Self {
        Self {
            repository_cache: Arc::new(RwLock::new(HashMap::new())),
            file_to_repo_cache: Arc::new(RwLock::new(HashMap::new())),
            github_url_cache: Arc::new(RwLock::new(HashMap::new())),
            github_url_fetches: Arc::new(Mutex::new(std::collections::HashSet::new())),
        }
    }

    /// Get cached repository information synchronously
    pub async fn get_cached_repository(&self, file_path: &str) -> Option<GitRepository> {
        let file_to_repo = self.file_to_repo_cache.read().await;
        if let Some(repo_path) = file_to_repo.get(file_path) {
            let repos = self.repository_cache.read().await;
            return repos.get(repo_path).cloned();
        }
        None
    }

    /// Find Git repository for a given file path and return its status
    pub async fn find_repository(&self, file_path: &str) -> Option<GitRepository> {
        // Validate path first
        if !Self::validate_path(file_path) {
            return None;
        }

        // Check cache first
        if let Some(cached) = self.get_cached_repository(file_path).await {
            return Some(cached);
        }

        // Find the Git repository root
        let repo_path = Self::find_git_root(file_path)?;

        // Check if we already have this repository cached
        {
            let repos = self.repository_cache.read().await;
            if let Some(cached_repo) = repos.get(&repo_path) {
                // Cache the file->repo mapping
                let mut file_to_repo = self.file_to_repo_cache.write().await;
                file_to_repo.insert(file_path.to_string(), repo_path.clone());
                return Some(cached_repo.clone());
            }
        }

        // Get repository status
        let repository = self.get_repository_status(&repo_path).await?;

        // Cache the result
        self.cache_repository(&repository, Some(file_path)).await;

        Some(repository)
    }

    /// Clear all caches
    pub async fn clear_cache(&self) {
        self.repository_cache.write().await.clear();
        self.file_to_repo_cache.write().await.clear();
        self.github_url_cache.write().await.clear();
        self.github_url_fetches.lock().await.clear();
    }

    /// Start monitoring and refreshing all cached repositories
    pub async fn start_monitoring(&self, app_handle: AppHandle) {
        let cache = self.repository_cache.clone();
        let github_cache = self.github_url_cache.clone();
        let fetches = self.github_url_fetches.clone();

        tokio::spawn(async move {
            let mut refresh_interval = interval(Duration::from_secs(5));
            loop {
                refresh_interval.tick().await;
                Self::refresh_all_cached(&cache, &github_cache, &fetches).await;
                // Emit event to update UI
                let _ = app_handle.emit("git-repos-updated", ());
            }
        });
    }

    /// Validate and sanitize paths
    fn validate_path(path: &str) -> bool {
        let path = Path::new(path);
        path.is_absolute() && path.exists()
    }

    /// Find the Git repository root starting from a given path
    fn find_git_root(path: &str) -> Option<String> {
        let mut current_path = PathBuf::from(path);

        // If it's a file, start from its directory
        if current_path.is_file() {
            current_path = current_path.parent()?.to_path_buf();
        }

        // Search up the directory tree to the root
        loop {
            let git_path = current_path.join(".git");
            if git_path.exists() {
                return current_path.to_str().map(|s| s.to_string());
            }

            if !current_path.pop() {
                break;
            }
        }

        None
    }

    /// Get repository status by running git status
    async fn get_repository_status(&self, repo_path: &str) -> Option<GitRepository> {
        // Get basic git status
        let mut repository = Self::get_basic_git_status(repo_path)?;

        // Check if we have a cached GitHub URL
        let github_urls = self.github_url_cache.read().await;
        if let Some(url) = github_urls.get(repo_path) {
            repository.github_url = Some(url.clone());
        } else {
            // Fetch GitHub URL in background
            let repo_path_clone = repo_path.to_string();
            let github_cache = self.github_url_cache.clone();
            let fetches = self.github_url_fetches.clone();
            tokio::spawn(async move {
                Self::fetch_github_url_background(repo_path_clone, github_cache, fetches).await;
            });
        }

        Some(repository)
    }

    /// Get basic repository status without GitHub URL
    fn get_basic_git_status(repo_path: &str) -> Option<GitRepository> {
        let output = Command::new("git")
            .args(&["status", "--porcelain", "--branch"])
            .current_dir(repo_path)
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let output_str = String::from_utf8(output.stdout).ok()?;
        Some(Self::parse_git_status(&output_str, repo_path))
    }

    /// Parse git status --porcelain output
    fn parse_git_status(output: &str, repo_path: &str) -> GitRepository {
        let lines: Vec<&str> = output.lines().collect();
        let mut current_branch = None;
        let mut modified_count = 0;
        let mut added_count = 0;
        let mut deleted_count = 0;
        let mut untracked_count = 0;

        for line in &lines {
            let trimmed = line.trim();

            // Parse branch information (first line with --branch flag)
            if trimmed.starts_with("##") {
                let branch_info = trimmed[2..].trim();
                // Extract branch name (format: "branch...tracking" or just "branch")
                if let Some(dot_index) = branch_info.find('.') {
                    current_branch = Some(branch_info[..dot_index].to_string());
                } else {
                    current_branch = Some(branch_info.to_string());
                }
                continue;
            }

            // Skip empty lines
            if trimmed.len() < 2 {
                continue;
            }

            // Get status code (first two characters)
            let status_code = &trimmed[..2];

            // Count files based on status codes
            match status_code {
                "??" => untracked_count += 1,
                code if code.contains('M') => modified_count += 1,
                code if code.contains('A') => added_count += 1,
                code if code.contains('D') => deleted_count += 1,
                code if code.contains('R') || code.contains('C') => modified_count += 1,
                code if code.contains('U') => modified_count += 1,
                _ => {}
            }
        }

        GitRepository {
            path: repo_path.to_string(),
            modified_count,
            added_count,
            deleted_count,
            untracked_count,
            current_branch,
            github_url: None,
        }
    }

    /// Fetch GitHub URL in background and cache it
    async fn fetch_github_url_background(
        repo_path: String,
        github_cache: Arc<RwLock<HashMap<String, String>>>,
        fetches: Arc<Mutex<std::collections::HashSet<String>>>,
    ) {
        // Check if already fetching
        {
            let mut fetches_guard = fetches.lock().await;
            if fetches_guard.contains(&repo_path) {
                return;
            }
            fetches_guard.insert(repo_path.clone());
        }

        // Fetch GitHub URL
        if let Some(github_url) = GitRepository::get_github_url(&repo_path) {
            github_cache.write().await.insert(repo_path.clone(), github_url);
        }

        // Remove from fetches
        fetches.lock().await.remove(&repo_path);
    }

    /// Refresh all cached repositories
    async fn refresh_all_cached(
        cache: &Arc<RwLock<HashMap<String, GitRepository>>>,
        github_cache: &Arc<RwLock<HashMap<String, String>>>,
        _fetches: &Arc<Mutex<std::collections::HashSet<String>>>,
    ) {
        let repo_paths: Vec<String> = {
            let repos = cache.read().await;
            repos.keys().cloned().collect()
        };

        for repo_path in repo_paths {
            if let Some(mut fresh) = Self::get_basic_git_status(&repo_path) {
                // Add GitHub URL if cached
                let github_urls = github_cache.read().await;
                if let Some(url) = github_urls.get(&repo_path) {
                    fresh.github_url = Some(url.clone());
                }

                cache.write().await.insert(repo_path, fresh);
            }
        }
    }

    /// Cache repository information
    async fn cache_repository(&self, repository: &GitRepository, original_file_path: Option<&str>) {
        self.repository_cache
            .write()
            .await
            .insert(repository.path.clone(), repository.clone());

        // Also map the original file path if different from repository path
        if let Some(file_path) = original_file_path {
            if file_path != repository.path {
                self.file_to_repo_cache
                    .write()
                    .await
                    .insert(file_path.to_string(), repository.path.clone());
            }
        }
    }
}