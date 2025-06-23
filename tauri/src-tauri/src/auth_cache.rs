use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Authentication token type
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TokenType {
    Bearer,
    Basic,
    ApiKey,
    OAuth2,
    JWT,
    Custom,
}

/// Authentication scope
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct AuthScope {
    pub service: String,
    pub resource: Option<String>,
    pub permissions: Vec<String>,
}

/// Cached authentication token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedToken {
    pub token_type: TokenType,
    pub token_value: String,
    pub scope: AuthScope,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub refresh_token: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl CachedToken {
    /// Check if token is expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            Utc::now() >= expires_at
        } else {
            false
        }
    }

    /// Check if token needs refresh (expires within threshold)
    pub fn needs_refresh(&self, threshold_seconds: i64) -> bool {
        if let Some(expires_at) = self.expires_at {
            let refresh_time = expires_at - Duration::seconds(threshold_seconds);
            Utc::now() >= refresh_time
        } else {
            false
        }
    }

    /// Get remaining lifetime in seconds
    #[allow(dead_code)]
    pub fn remaining_lifetime_seconds(&self) -> Option<i64> {
        self.expires_at.map(|expires_at| {
            let duration = expires_at - Utc::now();
            duration.num_seconds().max(0)
        })
    }
}

/// Authentication credential
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCredential {
    pub credential_type: String,
    pub username: Option<String>,
    pub password_hash: Option<String>, // Store hashed password
    pub api_key: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub metadata: HashMap<String, String>,
}

/// Authentication cache entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCacheEntry {
    pub key: String,
    pub tokens: Vec<CachedToken>,
    pub credential: Option<AuthCredential>,
    pub last_accessed: DateTime<Utc>,
    pub access_count: u64,
}

/// Authentication cache configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCacheConfig {
    pub enabled: bool,
    pub max_entries: usize,
    pub default_ttl_seconds: u64,
    pub refresh_threshold_seconds: i64,
    pub persist_to_disk: bool,
    pub encryption_enabled: bool,
    pub cleanup_interval_seconds: u64,
}

impl Default for AuthCacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_entries: 1000,
            default_ttl_seconds: 3600,      // 1 hour
            refresh_threshold_seconds: 300, // 5 minutes
            persist_to_disk: false,
            encryption_enabled: true,
            cleanup_interval_seconds: 600, // 10 minutes
        }
    }
}

/// Authentication cache statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCacheStats {
    pub total_entries: usize,
    pub total_tokens: usize,
    pub expired_tokens: usize,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub refresh_count: u64,
    pub eviction_count: u64,
}

/// Token refresh callback
pub type TokenRefreshCallback = Arc<
    dyn Fn(CachedToken) -> futures::future::BoxFuture<'static, Result<CachedToken, String>>
        + Send
        + Sync,
>;

/// Authentication cache manager
pub struct AuthCacheManager {
    config: Arc<RwLock<AuthCacheConfig>>,
    cache: Arc<RwLock<HashMap<String, AuthCacheEntry>>>,
    stats: Arc<RwLock<AuthCacheStats>>,
    refresh_callbacks: Arc<RwLock<HashMap<String, TokenRefreshCallback>>>,
    cleanup_handle: Arc<RwLock<Option<tokio::task::JoinHandle<()>>>>,
    notification_manager: Option<Arc<crate::notification_manager::NotificationManager>>,
}

impl Default for AuthCacheManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthCacheManager {
    /// Create a new authentication cache manager
    pub fn new() -> Self {
        

        Self {
            config: Arc::new(RwLock::new(AuthCacheConfig::default())),
            cache: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(RwLock::new(AuthCacheStats {
                total_entries: 0,
                total_tokens: 0,
                expired_tokens: 0,
                cache_hits: 0,
                cache_misses: 0,
                refresh_count: 0,
                eviction_count: 0,
            })),
            refresh_callbacks: Arc::new(RwLock::new(HashMap::new())),
            cleanup_handle: Arc::new(RwLock::new(None)),
            notification_manager: None,
        }
    }

    /// Set the notification manager
    pub fn set_notification_manager(
        &mut self,
        notification_manager: Arc<crate::notification_manager::NotificationManager>,
    ) {
        self.notification_manager = Some(notification_manager);
    }

    /// Get configuration
    pub async fn get_config(&self) -> AuthCacheConfig {
        self.config.read().await.clone()
    }

    /// Update configuration
    pub async fn update_config(&self, config: AuthCacheConfig) {
        *self.config.write().await = config;
    }

    /// Store token in cache
    pub async fn store_token(&self, key: &str, token: CachedToken) -> Result<(), String> {
        let config = self.config.read().await;
        if !config.enabled {
            return Ok(());
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        // Get or create cache entry
        let entry = cache.entry(key.to_string()).or_insert_with(|| {
            stats.total_entries += 1;
            AuthCacheEntry {
                key: key.to_string(),
                tokens: Vec::new(),
                credential: None,
                last_accessed: Utc::now(),
                access_count: 0,
            }
        });

        // Remove expired tokens
        let expired_count = entry.tokens.iter().filter(|t| t.is_expired()).count();
        stats.expired_tokens += expired_count;
        entry.tokens.retain(|t| !t.is_expired());

        // Add new token
        entry.tokens.push(token);
        stats.total_tokens += 1;
        entry.last_accessed = Utc::now();

        // Check cache size limit
        if cache.len() > config.max_entries {
            self.evict_oldest_entry(&mut cache, &mut stats);
        }

        Ok(())
    }

    /// Get token from cache
    pub async fn get_token(&self, key: &str, scope: &AuthScope) -> Option<CachedToken> {
        let config = self.config.read().await;
        if !config.enabled {
            return None;
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        if let Some(entry) = cache.get_mut(key) {
            entry.last_accessed = Utc::now();
            entry.access_count += 1;

            // Find matching token
            for token in &entry.tokens {
                if !token.is_expired() && self.token_matches_scope(token, scope) {
                    stats.cache_hits += 1;

                    // Check if needs refresh
                    if token.needs_refresh(config.refresh_threshold_seconds) {
                        // Trigger refresh in background
                        if let Some(refresh_callback) = self.refresh_callbacks.read().await.get(key)
                        {
                            let token_clone = token.clone();
                            let callback = refresh_callback.clone();
                            let key_clone = key.to_string();
                            let manager = self.clone_for_refresh();

                            tokio::spawn(async move {
                                if let Ok(refreshed_token) = callback(token_clone).await {
                                    let _ = manager.store_token(&key_clone, refreshed_token).await;
                                    manager.stats.write().await.refresh_count += 1;
                                }
                            });
                        }
                    }

                    return Some(token.clone());
                }
            }
        }

        stats.cache_misses += 1;
        None
    }

    /// Store credential in cache
    pub async fn store_credential(
        &self,
        key: &str,
        credential: AuthCredential,
    ) -> Result<(), String> {
        let config = self.config.read().await;
        if !config.enabled {
            return Ok(());
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        let entry = cache.entry(key.to_string()).or_insert_with(|| {
            stats.total_entries += 1;
            AuthCacheEntry {
                key: key.to_string(),
                tokens: Vec::new(),
                credential: None,
                last_accessed: Utc::now(),
                access_count: 0,
            }
        });

        entry.credential = Some(credential);
        entry.last_accessed = Utc::now();

        Ok(())
    }

    /// Get credential from cache
    pub async fn get_credential(&self, key: &str) -> Option<AuthCredential> {
        let config = self.config.read().await;
        if !config.enabled {
            return None;
        }

        let mut cache = self.cache.write().await;

        if let Some(entry) = cache.get_mut(key) {
            entry.last_accessed = Utc::now();
            entry.access_count += 1;
            return entry.credential.clone();
        }

        None
    }

    /// Register token refresh callback
    #[allow(dead_code)]
    pub async fn register_refresh_callback(&self, key: &str, callback: TokenRefreshCallback) {
        self.refresh_callbacks
            .write()
            .await
            .insert(key.to_string(), callback);
    }

    /// Clear specific cache entry
    pub async fn clear_entry(&self, key: &str) {
        let mut cache = self.cache.write().await;
        if cache.remove(key).is_some() {
            self.stats.write().await.total_entries = cache.len();
        }
    }

    /// Clear all cache entries
    pub async fn clear_all(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();

        let mut stats = self.stats.write().await;
        stats.total_entries = 0;
        stats.total_tokens = 0;
        stats.expired_tokens = 0;
    }

    /// Get cache statistics
    pub async fn get_stats(&self) -> AuthCacheStats {
        self.stats.read().await.clone()
    }

    /// List all cache entries
    pub async fn list_entries(&self) -> Vec<(String, DateTime<Utc>, u64)> {
        self.cache
            .read()
            .await
            .values()
            .map(|entry| (entry.key.clone(), entry.last_accessed, entry.access_count))
            .collect()
    }

    /// Export cache to JSON (for persistence)
    pub async fn export_cache(&self) -> Result<String, String> {
        let cache = self.cache.read().await;
        let entries: Vec<_> = cache.values().cloned().collect();

        serde_json::to_string_pretty(&entries)
            .map_err(|e| format!("Failed to serialize cache: {e}"))
    }

    /// Import cache from JSON
    pub async fn import_cache(&self, json_data: &str) -> Result<(), String> {
        let entries: Vec<AuthCacheEntry> = serde_json::from_str(json_data)
            .map_err(|e| format!("Failed to deserialize cache: {e}"))?;

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        for entry in entries {
            cache.insert(entry.key.clone(), entry);
        }

        stats.total_entries = cache.len();
        stats.total_tokens = cache.values().map(|e| e.tokens.len()).sum();

        Ok(())
    }

    /// Hash password for secure storage
    pub fn hash_password(password: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    // Helper methods
    fn token_matches_scope(&self, token: &CachedToken, scope: &AuthScope) -> bool {
        token.scope.service == scope.service
            && token.scope.resource == scope.resource
            && scope
                .permissions
                .iter()
                .all(|p| token.scope.permissions.contains(p))
    }

    fn evict_oldest_entry(
        &self,
        cache: &mut HashMap<String, AuthCacheEntry>,
        stats: &mut AuthCacheStats,
    ) {
        if let Some((key, _)) = cache.iter().min_by_key(|(_, entry)| entry.last_accessed) {
            let key = key.clone();
            cache.remove(&key);
            stats.eviction_count += 1;
            stats.total_entries = cache.len();
        }
    }

    pub async fn start_cleanup_task(&self) {
        let config = self.config.read().await;
        let cleanup_interval = Duration::seconds(config.cleanup_interval_seconds as i64);
        drop(config);

        loop {
            tokio::time::sleep(cleanup_interval.to_std().unwrap()).await;

            let config = self.config.read().await;
            if !config.enabled {
                continue;
            }
            drop(config);

            // Clean up expired tokens
            let mut cache = self.cache.write().await;
            let mut stats = self.stats.write().await;
            let mut total_expired = 0;

            for entry in cache.values_mut() {
                let expired_count = entry.tokens.iter().filter(|t| t.is_expired()).count();
                total_expired += expired_count;
                entry.tokens.retain(|t| !t.is_expired());
            }

            stats.expired_tokens += total_expired;
            stats.total_tokens = cache.values().map(|e| e.tokens.len()).sum();

            // Remove empty entries
            cache.retain(|_, entry| !entry.tokens.is_empty() || entry.credential.is_some());
            stats.total_entries = cache.len();
        }
    }

    #[allow(dead_code)]
    fn clone_for_cleanup(&self) -> Self {
        Self {
            config: self.config.clone(),
            cache: self.cache.clone(),
            stats: self.stats.clone(),
            refresh_callbacks: self.refresh_callbacks.clone(),
            cleanup_handle: self.cleanup_handle.clone(),
            notification_manager: self.notification_manager.clone(),
        }
    }

    fn clone_for_refresh(&self) -> Self {
        Self {
            config: self.config.clone(),
            cache: self.cache.clone(),
            stats: self.stats.clone(),
            refresh_callbacks: self.refresh_callbacks.clone(),
            cleanup_handle: self.cleanup_handle.clone(),
            notification_manager: self.notification_manager.clone(),
        }
    }
}

/// Create a cache key from components
pub fn create_cache_key(service: &str, username: Option<&str>, resource: Option<&str>) -> String {
    let mut components = vec![service];
    if let Some(user) = username {
        components.push(user);
    }
    if let Some(res) = resource {
        components.push(res);
    }
    components.join(":")
}

/// Authentication cache error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCacheError {
    pub code: String,
    pub message: String,
    pub details: Option<HashMap<String, String>>,
}
