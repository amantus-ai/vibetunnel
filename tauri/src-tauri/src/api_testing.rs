use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

/// API test method
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    PATCH,
    DELETE,
    HEAD,
    OPTIONS,
}

impl HttpMethod {
    #[allow(dead_code)]
    pub const fn as_str(&self) -> &str {
        match self {
            Self::GET => "GET",
            Self::POST => "POST",
            Self::PUT => "PUT",
            Self::PATCH => "PATCH",
            Self::DELETE => "DELETE",
            Self::HEAD => "HEAD",
            Self::OPTIONS => "OPTIONS",
        }
    }
}

/// API test assertion type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AssertionType {
    StatusCode(u16),
    StatusRange {
        min: u16,
        max: u16,
    },
    ResponseTime {
        max_ms: u64,
    },
    HeaderExists(String),
    HeaderEquals {
        key: String,
        value: String,
    },
    JsonPath {
        path: String,
        expected: serde_json::Value,
    },
    BodyContains(String),
    BodyMatches(String), // Regex
    ContentType(String),
}

/// API test case
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub group: Option<String>,
    pub endpoint_url: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>,
    pub query_params: HashMap<String, String>,
    pub body: Option<APITestBody>,
    pub auth: Option<APITestAuth>,
    pub assertions: Vec<AssertionType>,
    pub timeout_ms: u64,
    pub retry_count: u32,
    pub delay_ms: Option<u64>,
    pub save_response: bool,
}

/// API test body
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum APITestBody {
    Json(serde_json::Value),
    Form(HashMap<String, String>),
    Text(String),
    Binary(Vec<u8>),
}

/// API test authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum APITestAuth {
    Basic {
        username: String,
        password: String,
    },
    Bearer(String),
    ApiKey {
        key: String,
        value: String,
        in_header: bool,
    },
    Custom(HashMap<String, String>),
}

/// API test result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITestResult {
    pub test_id: String,
    pub test_name: String,
    pub success: bool,
    pub timestamp: DateTime<Utc>,
    pub duration_ms: u64,
    pub status_code: Option<u16>,
    pub response_headers: HashMap<String, String>,
    pub response_body: Option<String>,
    pub assertion_results: Vec<AssertionResult>,
    pub error: Option<String>,
    pub retries_used: u32,
}

/// Assertion result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssertionResult {
    pub assertion: AssertionType,
    pub passed: bool,
    pub actual_value: Option<String>,
    pub error_message: Option<String>,
}

/// API test suite
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITestSuite {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub base_url: Option<String>,
    pub default_headers: HashMap<String, String>,
    pub default_auth: Option<APITestAuth>,
    pub tests: Vec<APITest>,
    pub setup_tests: Vec<APITest>,
    pub teardown_tests: Vec<APITest>,
    pub variables: HashMap<String, String>,
}

/// API test collection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITestCollection {
    pub id: String,
    pub name: String,
    pub suites: Vec<APITestSuite>,
    pub global_variables: HashMap<String, String>,
}

/// API test runner configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITestRunnerConfig {
    pub parallel_execution: bool,
    pub max_parallel_tests: usize,
    pub stop_on_failure: bool,
    pub capture_responses: bool,
    pub follow_redirects: bool,
    pub verify_ssl: bool,
    pub proxy: Option<String>,
    pub environment_variables: HashMap<String, String>,
}

impl Default for APITestRunnerConfig {
    fn default() -> Self {
        Self {
            parallel_execution: false,
            max_parallel_tests: 5,
            stop_on_failure: false,
            capture_responses: true,
            follow_redirects: true,
            verify_ssl: true,
            proxy: None,
            environment_variables: HashMap::new(),
        }
    }
}

/// API test history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITestHistoryEntry {
    pub run_id: String,
    pub timestamp: DateTime<Utc>,
    pub suite_name: String,
    pub total_tests: usize,
    pub passed_tests: usize,
    pub failed_tests: usize,
    pub total_duration_ms: u64,
    pub results: Vec<APITestResult>,
}

/// API testing manager
pub struct APITestingManager {
    client: Arc<Client>,
    config: Arc<RwLock<APITestRunnerConfig>>,
    test_suites: Arc<RwLock<HashMap<String, APITestSuite>>>,
    test_history: Arc<RwLock<Vec<APITestHistoryEntry>>>,
    running_tests: Arc<RwLock<HashMap<String, bool>>>,
    shared_variables: Arc<RwLock<HashMap<String, String>>>,
    notification_manager: Option<Arc<crate::notification_manager::NotificationManager>>,
}

impl Default for APITestingManager {
    fn default() -> Self {
        Self::new()
    }
}

impl APITestingManager {
    /// Create a new API testing manager
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();

        Self {
            client: Arc::new(client),
            config: Arc::new(RwLock::new(APITestRunnerConfig::default())),
            test_suites: Arc::new(RwLock::new(HashMap::new())),
            test_history: Arc::new(RwLock::new(Vec::new())),
            running_tests: Arc::new(RwLock::new(HashMap::new())),
            shared_variables: Arc::new(RwLock::new(HashMap::new())),
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
    pub async fn get_config(&self) -> APITestRunnerConfig {
        self.config.read().await.clone()
    }

    /// Update configuration
    pub async fn update_config(&self, config: APITestRunnerConfig) {
        *self.config.write().await = config;
    }

    /// Add test suite
    pub async fn add_test_suite(&self, suite: APITestSuite) {
        self.test_suites
            .write()
            .await
            .insert(suite.id.clone(), suite);
    }

    /// Get test suite
    pub async fn get_test_suite(&self, suite_id: &str) -> Option<APITestSuite> {
        self.test_suites.read().await.get(suite_id).cloned()
    }

    /// List test suites
    pub async fn list_test_suites(&self) -> Vec<APITestSuite> {
        self.test_suites.read().await.values().cloned().collect()
    }

    /// Run single test
    pub async fn run_test(
        &self,
        test: &APITest,
        variables: &HashMap<String, String>,
    ) -> APITestResult {
        let start_time = std::time::Instant::now();
        let mut result = APITestResult {
            test_id: test.id.clone(),
            test_name: test.name.clone(),
            success: false,
            timestamp: Utc::now(),
            duration_ms: 0,
            status_code: None,
            response_headers: HashMap::new(),
            response_body: None,
            assertion_results: Vec::new(),
            error: None,
            retries_used: 0,
        };

        // Replace variables in URL
        let url = self.replace_variables(&test.endpoint_url, variables);

        // Run test with retries
        let mut last_error = None;
        for retry in 0..=test.retry_count {
            if retry > 0 {
                // Delay between retries
                if let Some(delay) = test.delay_ms {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }

            match self.execute_request(test, &url, variables).await {
                Ok((status, headers, body)) => {
                    result.status_code = Some(status);
                    result.response_headers = headers;
                    if test.save_response {
                        result.response_body = Some(body.clone());
                    }
                    result.retries_used = retry;

                    // Run assertions
                    result.assertion_results = self
                        .run_assertions(&test.assertions, status, &result.response_headers, &body)
                        .await;
                    result.success = result.assertion_results.iter().all(|a| a.passed);

                    break;
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }

        if let Some(error) = last_error {
            result.error = Some(error);
        }

        result.duration_ms = start_time.elapsed().as_millis() as u64;
        result
    }

    /// Run test suite
    pub async fn run_test_suite(&self, suite_id: &str) -> Option<APITestHistoryEntry> {
        let suite = self.get_test_suite(suite_id).await?;
        let run_id = uuid::Uuid::new_v4().to_string();
        let start_time = std::time::Instant::now();

        // Merge variables
        let mut variables = self.shared_variables.read().await.clone();
        variables.extend(suite.variables.clone());

        let mut results = Vec::new();

        // Run setup tests
        for test in &suite.setup_tests {
            let result = self.run_test(test, &variables).await;
            if !result.success && self.config.read().await.stop_on_failure {
                break;
            }
            results.push(result);
        }

        // Run main tests
        let config = self.config.read().await;
        if config.parallel_execution {
            // Run tests in parallel
            let mut tasks = Vec::new();
            for test in &suite.tests {
                let test = test.clone();
                let vars = variables.clone();
                let manager = self.clone_for_parallel();

                tasks.push(tokio::spawn(
                    async move { manager.run_test(&test, &vars).await },
                ));
            }

            for task in tasks {
                if let Ok(result) = task.await {
                    results.push(result);
                }
            }
        } else {
            // Run tests sequentially
            for test in &suite.tests {
                let result = self.run_test(test, &variables).await;
                if !result.success && config.stop_on_failure {
                    break;
                }
                results.push(result);
            }
        }

        // Run teardown tests
        for test in &suite.teardown_tests {
            let result = self.run_test(test, &variables).await;
            results.push(result);
        }

        let total_duration = start_time.elapsed().as_millis() as u64;
        let passed = results.iter().filter(|r| r.success).count();
        let failed = results.len() - passed;

        let history_entry = APITestHistoryEntry {
            run_id,
            timestamp: Utc::now(),
            suite_name: suite.name,
            total_tests: results.len(),
            passed_tests: passed,
            failed_tests: failed,
            total_duration_ms: total_duration,
            results,
        };

        // Store in history
        self.test_history.write().await.push(history_entry.clone());

        // Send notification
        if let Some(notification_manager) = &self.notification_manager {
            let message = format!("Test suite completed: {passed} passed, {failed} failed");
            let _ = notification_manager
                .notify_success("API Tests", &message)
                .await;
        }

        Some(history_entry)
    }

    /// Get test history
    pub async fn get_test_history(&self, limit: Option<usize>) -> Vec<APITestHistoryEntry> {
        let history = self.test_history.read().await;
        match limit {
            Some(n) => history.iter().rev().take(n).cloned().collect(),
            None => history.clone(),
        }
    }

    /// Clear test history
    pub async fn clear_test_history(&self) {
        self.test_history.write().await.clear();
    }

    /// Import Postman collection
    pub async fn import_postman_collection(&self, _json_data: &str) -> Result<String, String> {
        // TODO: Implement Postman collection import
        Err("Postman import not yet implemented".to_string())
    }

    /// Export test suite
    pub async fn export_test_suite(&self, suite_id: &str) -> Result<String, String> {
        let suite = self
            .get_test_suite(suite_id)
            .await
            .ok_or_else(|| "Test suite not found".to_string())?;

        serde_json::to_string_pretty(&suite)
            .map_err(|e| format!("Failed to serialize test suite: {e}"))
    }

    // Helper methods
    async fn execute_request(
        &self,
        test: &APITest,
        url: &str,
        variables: &HashMap<String, String>,
    ) -> Result<(u16, HashMap<String, String>, String), String> {
        let config = self.config.read().await;
        let client = Client::builder()
            .timeout(Duration::from_millis(test.timeout_ms))
            .redirect(if config.follow_redirects {
                reqwest::redirect::Policy::default()
            } else {
                reqwest::redirect::Policy::none()
            })
            .danger_accept_invalid_certs(!config.verify_ssl)
            .build()
            .map_err(|e| e.to_string())?;

        let mut request = match test.method {
            HttpMethod::GET => client.get(url),
            HttpMethod::POST => client.post(url),
            HttpMethod::PUT => client.put(url),
            HttpMethod::PATCH => client.patch(url),
            HttpMethod::DELETE => client.delete(url),
            HttpMethod::HEAD => client.head(url),
            HttpMethod::OPTIONS => client.request(reqwest::Method::OPTIONS, url),
        };

        // Add headers
        for (key, value) in &test.headers {
            let value = self.replace_variables(value, variables);
            request = request.header(key, value);
        }

        // Add query params
        for (key, value) in &test.query_params {
            let value = self.replace_variables(value, variables);
            request = request.query(&[(key, value)]);
        }

        // Add auth
        if let Some(auth) = &test.auth {
            request = self.apply_auth(request, auth, variables);
        }

        // Add body
        if let Some(body) = &test.body {
            request = match body {
                APITestBody::Json(json) => request.json(json),
                APITestBody::Form(form) => request.form(form),
                APITestBody::Text(text) => request.body(text.clone()),
                APITestBody::Binary(bytes) => request.body(bytes.clone()),
            };
        }

        // Execute request
        let response = request.send().await.map_err(|e| e.to_string())?;
        let status = response.status().as_u16();

        let mut headers = HashMap::new();
        for (key, value) in response.headers() {
            if let Ok(value_str) = value.to_str() {
                headers.insert(key.to_string(), value_str.to_string());
            }
        }

        let body = response.text().await.unwrap_or_default();

        Ok((status, headers, body))
    }

    async fn run_assertions(
        &self,
        assertions: &[AssertionType],
        status: u16,
        headers: &HashMap<String, String>,
        body: &str,
    ) -> Vec<AssertionResult> {
        let mut results = Vec::new();

        for assertion in assertions {
            let result = match assertion {
                AssertionType::StatusCode(expected) => AssertionResult {
                    assertion: assertion.clone(),
                    passed: status == *expected,
                    actual_value: Some(status.to_string()),
                    error_message: if status == *expected {
                        None
                    } else {
                        Some(format!("Expected status {expected}, got {status}"))
                    },
                },
                AssertionType::StatusRange { min, max } => AssertionResult {
                    assertion: assertion.clone(),
                    passed: status >= *min && status <= *max,
                    actual_value: Some(status.to_string()),
                    error_message: if status < *min || status > *max {
                        Some(format!(
                            "Expected status between {min} and {max}, got {status}"
                        ))
                    } else {
                        None
                    },
                },
                AssertionType::HeaderExists(key) => AssertionResult {
                    assertion: assertion.clone(),
                    passed: headers.contains_key(key),
                    actual_value: None,
                    error_message: if headers.contains_key(key) {
                        None
                    } else {
                        Some(format!("Header '{key}' not found"))
                    },
                },
                AssertionType::HeaderEquals { key, value } => {
                    let actual = headers.get(key);
                    AssertionResult {
                        assertion: assertion.clone(),
                        passed: actual == Some(value),
                        actual_value: actual.cloned(),
                        error_message: if actual == Some(value) {
                            None
                        } else {
                            Some(format!(
                                "Header '{key}' expected '{value}', got '{actual:?}'"
                            ))
                        },
                    }
                }
                AssertionType::BodyContains(text) => AssertionResult {
                    assertion: assertion.clone(),
                    passed: body.contains(text),
                    actual_value: None,
                    error_message: if body.contains(text) {
                        None
                    } else {
                        Some(format!("Body does not contain '{text}'"))
                    },
                },
                AssertionType::JsonPath {
                    path: _,
                    expected: _,
                } => {
                    // TODO: Implement JSON path assertion
                    AssertionResult {
                        assertion: assertion.clone(),
                        passed: false,
                        actual_value: None,
                        error_message: Some("JSON path assertions not yet implemented".to_string()),
                    }
                }
                _ => AssertionResult {
                    assertion: assertion.clone(),
                    passed: false,
                    actual_value: None,
                    error_message: Some("Assertion type not implemented".to_string()),
                },
            };
            results.push(result);
        }

        results
    }

    fn replace_variables(&self, text: &str, variables: &HashMap<String, String>) -> String {
        let mut result = text.to_string();
        for (key, value) in variables {
            result = result.replace(&format!("{{{{{key}}}}}"), value);
        }
        result
    }

    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        auth: &APITestAuth,
        variables: &HashMap<String, String>,
    ) -> reqwest::RequestBuilder {
        match auth {
            APITestAuth::Basic { username, password } => {
                let username = self.replace_variables(username, variables);
                let password = self.replace_variables(password, variables);
                request.basic_auth(username, Some(password))
            }
            APITestAuth::Bearer(token) => {
                let token = self.replace_variables(token, variables);
                request.bearer_auth(token)
            }
            APITestAuth::ApiKey {
                key,
                value,
                in_header,
            } => {
                let key = self.replace_variables(key, variables);
                let value = self.replace_variables(value, variables);
                if *in_header {
                    request.header(key, value)
                } else {
                    request.query(&[(key, value)])
                }
            }
            APITestAuth::Custom(headers) => {
                let mut req = request;
                for (key, value) in headers {
                    let value = self.replace_variables(value, variables);
                    req = req.header(key, value);
                }
                req
            }
        }
    }

    fn clone_for_parallel(&self) -> Self {
        Self {
            client: self.client.clone(),
            config: self.config.clone(),
            test_suites: self.test_suites.clone(),
            test_history: self.test_history.clone(),
            running_tests: self.running_tests.clone(),
            shared_variables: self.shared_variables.clone(),
            notification_manager: self.notification_manager.clone(),
        }
    }
}

/// API test statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APITestStatistics {
    pub total_suites: usize,
    pub total_tests: usize,
    pub total_runs: usize,
    pub success_rate: f64,
    pub average_duration_ms: f64,
    pub most_failed_tests: Vec<(String, usize)>,
    pub slowest_tests: Vec<(String, u64)>,
}
