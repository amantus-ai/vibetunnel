use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE_NAME: &str = "VibeTunnel";
const DASHBOARD_PASSWORD_KEY: &str = "dashboard_password";
const NGROK_AUTH_TOKEN_KEY: &str = "ngrok_auth_token";

#[derive(Debug, Serialize, Deserialize)]
pub struct KeychainError {
    pub message: String,
}

impl From<KeyringError> for KeychainError {
    fn from(err: KeyringError) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

pub struct KeychainManager;

impl KeychainManager {
    /// Store a password in the system keychain
    pub fn set_password(key: &str, password: &str) -> Result<(), KeychainError> {
        let entry = Entry::new(SERVICE_NAME, key)?;
        entry.set_password(password)?;
        Ok(())
    }

    /// Retrieve a password from the system keychain
    pub fn get_password(key: &str) -> Result<Option<String>, KeychainError> {
        let entry = Entry::new(SERVICE_NAME, key)?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Delete a password from the system keychain
    pub fn delete_password(key: &str) -> Result<(), KeychainError> {
        let entry = Entry::new(SERVICE_NAME, key)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()), // Already deleted
            Err(err) => Err(err.into()),
        }
    }

    /// Store the dashboard password
    pub fn set_dashboard_password(password: &str) -> Result<(), KeychainError> {
        Self::set_password(DASHBOARD_PASSWORD_KEY, password)
    }

    /// Get the dashboard password
    pub fn get_dashboard_password() -> Result<Option<String>, KeychainError> {
        Self::get_password(DASHBOARD_PASSWORD_KEY)
    }

    /// Delete the dashboard password
    pub fn delete_dashboard_password() -> Result<(), KeychainError> {
        Self::delete_password(DASHBOARD_PASSWORD_KEY)
    }

    /// Store the ngrok auth token
    pub fn set_ngrok_auth_token(token: &str) -> Result<(), KeychainError> {
        Self::set_password(NGROK_AUTH_TOKEN_KEY, token)
    }

    /// Get the ngrok auth token
    pub fn get_ngrok_auth_token() -> Result<Option<String>, KeychainError> {
        Self::get_password(NGROK_AUTH_TOKEN_KEY)
    }

    /// Delete the ngrok auth token
    pub fn delete_ngrok_auth_token() -> Result<(), KeychainError> {
        Self::delete_password(NGROK_AUTH_TOKEN_KEY)
    }

    /// Get all stored credentials (returns keys only, not passwords)
    pub fn list_stored_keys() -> Vec<String> {
        let mut keys = Vec::new();

        // Check if dashboard password exists
        if Self::get_dashboard_password().unwrap_or(None).is_some() {
            keys.push(DASHBOARD_PASSWORD_KEY.to_string());
        }

        // Check if ngrok token exists
        if Self::get_ngrok_auth_token().unwrap_or(None).is_some() {
            keys.push(NGROK_AUTH_TOKEN_KEY.to_string());
        }

        keys
    }

    /// Migrate passwords from settings to keychain
    #[allow(dead_code)]
    pub fn migrate_from_settings(settings: &HashMap<String, String>) -> Result<(), KeychainError> {
        // Migrate dashboard password
        if let Some(password) = settings.get("dashboard_password") {
            if !password.is_empty() {
                Self::set_dashboard_password(password)?;
            }
        }

        // Migrate ngrok auth token
        if let Some(token) = settings.get("ngrok_auth_token") {
            if !token.is_empty() {
                Self::set_ngrok_auth_token(token)?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "Requires system keychain access"]
    fn test_password_operations() {
        let test_key = "test_password";
        let test_password = "super_secret_123";

        // Store password
        assert!(KeychainManager::set_password(test_key, test_password).is_ok());

        // Retrieve password
        let retrieved = KeychainManager::get_password(test_key).unwrap();
        assert_eq!(retrieved, Some(test_password.to_string()));

        // Delete password
        assert!(KeychainManager::delete_password(test_key).is_ok());

        // Verify deletion
        let deleted = KeychainManager::get_password(test_key).unwrap();
        assert_eq!(deleted, None);
    }
}
