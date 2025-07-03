use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{debug, info};

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;

/// Manages system power assertions to prevent the system from sleeping
pub struct PowerManager {
    is_prevented: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    assertion_id: std::sync::Mutex<Option<u32>>,
    #[cfg(target_os = "windows")]
    _previous_state: std::sync::Mutex<Option<u32>>,
}

impl PowerManager {
    pub fn new() -> Self {
        Self {
            is_prevented: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            assertion_id: std::sync::Mutex::new(None),
            #[cfg(target_os = "windows")]
            _previous_state: std::sync::Mutex::new(None),
        }
    }

    /// Prevents the system from sleeping
    pub fn prevent_sleep(&self) -> Result<(), String> {
        if self.is_prevented.load(Ordering::Relaxed) {
            debug!("Sleep is already prevented");
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        {
            self.prevent_sleep_macos()?;
        }

        #[cfg(target_os = "windows")]
        {
            self.prevent_sleep_windows()?;
        }

        #[cfg(target_os = "linux")]
        {
            self.prevent_sleep_linux()?;
        }

        self.is_prevented.store(true, Ordering::Relaxed);
        info!("System sleep prevention enabled");
        Ok(())
    }

    /// Allows the system to sleep normally
    pub fn allow_sleep(&self) -> Result<(), String> {
        if !self.is_prevented.load(Ordering::Relaxed) {
            debug!("Sleep is already allowed");
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        {
            self.allow_sleep_macos()?;
        }

        #[cfg(target_os = "windows")]
        {
            self.allow_sleep_windows()?;
        }

        #[cfg(target_os = "linux")]
        {
            self.allow_sleep_linux()?;
        }

        self.is_prevented.store(false, Ordering::Relaxed);
        info!("System sleep prevention disabled");
        Ok(())
    }

    /// Returns whether sleep is currently prevented
    pub fn is_sleep_prevented(&self) -> bool {
        self.is_prevented.load(Ordering::Relaxed)
    }

    #[cfg(target_os = "macos")]
    fn prevent_sleep_macos(&self) -> Result<(), String> {
        use std::os::raw::c_void;

        #[link(name = "IOKit", kind = "framework")]
        extern "C" {
            fn IOPMAssertionCreateWithName(
                assertion_type: *const c_void,
                assertion_level: u32,
                reason: *const c_void,
                assertion_id: *mut u32,
            ) -> i32;
        }

        const kIOPMAssertionLevelOn: u32 = 255;
        const kIOReturnSuccess: i32 = 0;

        let assertion_type = CFString::from("NoIdleSleepAssertion");
        let reason = CFString::from("VibeTunnel is running terminal sessions");

        let mut assertion_id: u32 = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type.as_concrete_TypeRef() as *const c_void,
                kIOPMAssertionLevelOn,
                reason.as_concrete_TypeRef() as *const c_void,
                &mut assertion_id,
            )
        };

        if result == kIOReturnSuccess {
            let mut guard = self.assertion_id.lock().unwrap();
            *guard = Some(assertion_id);
            Ok(())
        } else {
            Err(format!("Failed to create power assertion: {}", result))
        }
    }

    #[cfg(target_os = "macos")]
    fn allow_sleep_macos(&self) -> Result<(), String> {

        #[link(name = "IOKit", kind = "framework")]
        extern "C" {
            fn IOPMAssertionRelease(assertion_id: u32) -> i32;
        }

        const kIOReturnSuccess: i32 = 0;

        let mut guard = self.assertion_id.lock().unwrap();
        if let Some(assertion_id) = guard.take() {
            let result = unsafe { IOPMAssertionRelease(assertion_id) };

            if result == kIOReturnSuccess {
                Ok(())
            } else {
                Err(format!("Failed to release power assertion: {}", result))
            }
        } else {
            Ok(())
        }
    }

    #[cfg(target_os = "windows")]
    fn prevent_sleep_windows(&self) -> Result<(), String> {
        use std::os::raw::c_uint;

        #[link(name = "kernel32")]
        extern "system" {
            fn SetThreadExecutionState(flags: c_uint) -> c_uint;
        }

        const ES_CONTINUOUS: c_uint = 0x80000000;
        const ES_SYSTEM_REQUIRED: c_uint = 0x00000001;
        const ES_DISPLAY_REQUIRED: c_uint = 0x00000002;

        let flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED;
        let result = unsafe { SetThreadExecutionState(flags) };

        if result == 0 {
            Err("Failed to set thread execution state".to_string())
        } else {
            let mut guard = self._previous_state.lock().unwrap();
            *guard = Some(result);
            Ok(())
        }
    }

    #[cfg(target_os = "windows")]
    fn allow_sleep_windows(&self) -> Result<(), String> {
        use std::os::raw::c_uint;

        #[link(name = "kernel32")]
        extern "system" {
            fn SetThreadExecutionState(flags: c_uint) -> c_uint;
        }

        const ES_CONTINUOUS: c_uint = 0x80000000;

        let result = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };

        if result == 0 {
            Err("Failed to reset thread execution state".to_string())
        } else {
            Ok(())
        }
    }

    #[cfg(target_os = "linux")]
    fn prevent_sleep_linux(&self) -> Result<(), String> {
        // On Linux, we can use systemd-inhibit or DBus to prevent sleep
        // For now, we'll use a simple implementation
        debug!("Linux sleep prevention not implemented");
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn allow_sleep_linux(&self) -> Result<(), String> {
        debug!("Linux sleep allowance not implemented");
        Ok(())
    }
}

impl Drop for PowerManager {
    fn drop(&mut self) {
        if self.is_prevented.load(Ordering::Relaxed) {
            let _ = self.allow_sleep();
        }
    }
}

// Public functions for commands (without tauri::command attribute)
pub fn prevent_sleep(state: tauri::State<crate::state::AppState>) -> Result<(), String> {
    state.power_manager.prevent_sleep()
}

pub fn allow_sleep(state: tauri::State<crate::state::AppState>) -> Result<(), String> {
    state.power_manager.allow_sleep()
}

pub fn is_sleep_prevented(state: tauri::State<crate::state::AppState>) -> bool {
    state.power_manager.is_sleep_prevented()
}

// Integration with session monitoring
impl PowerManager {
    /// Updates sleep prevention based on session count and user preferences
    pub async fn update_for_sessions(&self, session_count: usize, prevent_sleep_enabled: bool) {
        if prevent_sleep_enabled && session_count > 0 {
            let _ = self.prevent_sleep();
        } else {
            let _ = self.allow_sleep();
        }
    }
}