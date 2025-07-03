use tracing::{debug, info, warn};

/// Process information
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
}

/// Handles process tree traversal and process information extraction
pub struct ProcessTracker;

impl ProcessTracker {
    /// Get the parent process ID of a given process
    pub fn get_parent_process_id(pid: u32) -> Option<u32> {
        #[cfg(target_os = "macos")]
        {
            Self::get_parent_pid_macos(pid)
        }
        #[cfg(target_os = "windows")]
        {
            Self::get_parent_pid_windows(pid)
        }
        #[cfg(target_os = "linux")]
        {
            Self::get_parent_pid_linux(pid)
        }
    }

    /// Get process info including name and parent PID
    pub fn get_process_info(pid: u32) -> Option<ProcessInfo> {
        #[cfg(target_os = "macos")]
        {
            Self::get_process_info_macos(pid)
        }
        #[cfg(target_os = "windows")]
        {
            Self::get_process_info_windows(pid)
        }
        #[cfg(target_os = "linux")]
        {
            Self::get_process_info_linux(pid)
        }
    }

    /// Log the process tree for debugging
    pub fn log_process_tree(pid: u32) {
        debug!("Process tree for PID {}:", pid);
        
        let mut current_pid = pid;
        let mut depth = 0;
        
        while depth < 20 {
            if let Some(info) = Self::get_process_info(current_pid) {
                let indent = "  ".repeat(depth);
                debug!("{}PID {}: {} (parent: {})", indent, current_pid, info.name, info.ppid);
                
                if info.ppid == 0 || info.ppid == 1 {
                    break;
                }
                
                current_pid = info.ppid;
                depth += 1;
            } else {
                break;
            }
        }
    }

    /// Find the terminal process in the ancestry of a given PID
    pub fn find_terminal_ancestor(pid: u32, max_depth: usize) -> Option<u32> {
        let mut current_pid = pid;
        let mut depth = 0;
        
        while depth < max_depth {
            if let Some(parent_pid) = Self::get_parent_process_id(current_pid) {
                debug!("Checking ancestor process PID: {} at depth {}", parent_pid, depth + 1);
                
                // Check if this is a terminal process
                if let Some(info) = Self::get_process_info(parent_pid) {
                    let terminal_processes = vec![
                        "Terminal", "iTerm2", "alacritty", "kitty", "wezterm",
                        "gnome-terminal", "konsole", "xterm", "cmd.exe", "powershell.exe",
                        "WindowsTerminal.exe"
                    ];
                    
                    if terminal_processes.iter().any(|&tp| info.name.contains(tp)) {
                        info!("Found terminal ancestor: {} (PID: {})", info.name, parent_pid);
                        return Some(parent_pid);
                    }
                }
                
                current_pid = parent_pid;
                depth += 1;
            } else {
                break;
            }
        }
        
        None
    }

    #[cfg(target_os = "macos")]
    fn get_parent_pid_macos(pid: u32) -> Option<u32> {
        use std::mem;
        use libc::{c_int, size_t, sysctl, CTL_KERN, KERN_PROC, KERN_PROC_PID};
        
        #[repr(C)]
        struct kinfo_proc {
            kp_proc: extern_proc,
            kp_eproc: eproc,
        }
        
        #[repr(C)]
        struct extern_proc {
            p_un: [u8; 16],
            p_vmspace: u64,
            p_sigacts: u64,
            p_flag: i32,
            p_stat: u8,
            p_pid: i32,
            p_oppid: i32,
            p_dupfd: i32,
            p_pgid: i32,
            p_ppid: i32,
            p_gid: i32,
            p_comm: [u8; 17],
            p_pgrp: u64,
            p_addr: u64,
            p_xstat: u16,
            p_acflag: u16,
            p_ru: u64,
        }
        
        #[repr(C)]
        struct eproc {
            e_paddr: u64,
            e_sess: u64,
            e_pcred: pcred,
            e_ucred: ucred,
            e_vm: vmspace,
            e_ppid: i32,
            e_pgid: i32,
            e_jobc: i16,
            e_tdev: i32,
            e_tpgid: i32,
            e_tsess: u64,
            e_wmesg: [u8; 8],
            e_xsize: i64,
            e_xrssize: i16,
            e_xccount: i16,
            e_xswrss: i16,
            e_flag: i32,
            e_login: [u8; 12],
            e_spare: [i32; 4],
        }
        
        #[repr(C)]
        struct pcred {
            pc_lock: [u8; 72],
            pc_ucred: u64,
            p_ruid: u32,
            p_svuid: u32,
            p_rgid: u32,
            p_svgid: u32,
            p_refcnt: i32,
        }
        
        #[repr(C)]
        struct ucred {
            cr_ref: i32,
            cr_uid: u32,
            cr_ngroups: i16,
            cr_groups: [u32; 16],
        }
        
        #[repr(C)]
        struct vmspace {
            dummy: [u8; 32],
        }
        
        let mut info: kinfo_proc = unsafe { mem::zeroed() };
        let mut size = mem::size_of::<kinfo_proc>();
        let mut mib = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid as c_int];
        
        let result = unsafe {
            sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                &mut info as *mut _ as *mut _,
                &mut size as *mut _ as *mut size_t,
                std::ptr::null_mut(),
                0,
            )
        };
        
        if result == 0 && size > 0 {
            Some(info.kp_eproc.e_ppid as u32)
        } else {
            None
        }
    }

    #[cfg(target_os = "macos")]
    fn get_process_info_macos(pid: u32) -> Option<ProcessInfo> {
        use std::process::Command;
        
        // Use ps command as a fallback for process info
        match Command::new("ps")
            .args(&["-p", &pid.to_string(), "-o", "ppid=,comm="])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    let parts: Vec<&str> = output_str.trim().split_whitespace().collect();
                    if parts.len() >= 2 {
                        let ppid = parts[0].parse::<u32>().unwrap_or(0);
                        let name = parts[1..].join(" ");
                        return Some(ProcessInfo { pid, ppid, name });
                    }
                }
            }
            Err(e) => {
                warn!("Failed to run ps command: {}", e);
            }
        }
        
        // Try to at least get parent PID
        if let Some(ppid) = Self::get_parent_pid_macos(pid) {
            Some(ProcessInfo {
                pid,
                ppid,
                name: format!("Process {}", pid),
            })
        } else {
            None
        }
    }

    #[cfg(target_os = "windows")]
    fn get_parent_pid_windows(pid: u32) -> Option<u32> {
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
        };
        use windows::Win32::Foundation::HANDLE;
        
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            
            let mut process_entry = PROCESSENTRY32 {
                dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
                ..Default::default()
            };
            
            if Process32First(snapshot, &mut process_entry).is_ok() {
                loop {
                    if process_entry.th32ProcessID == pid {
                        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
                        return Some(process_entry.th32ParentProcessID);
                    }
                    
                    if !Process32Next(snapshot, &mut process_entry).is_ok() {
                        break;
                    }
                }
            }
            
            let _ = windows::Win32::Foundation::CloseHandle(snapshot);
        }
        
        None
    }

    #[cfg(target_os = "windows")]
    fn get_process_info_windows(pid: u32) -> Option<ProcessInfo> {
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
        };
        
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            
            let mut process_entry = PROCESSENTRY32 {
                dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
                ..Default::default()
            };
            
            if Process32First(snapshot, &mut process_entry).is_ok() {
                loop {
                    if process_entry.th32ProcessID == pid {
                        let name = String::from_utf16_lossy(
                            &process_entry.szExeFile
                                .iter()
                                .take_while(|&&c| c != 0)
                                .copied()
                                .collect::<Vec<u16>>()
                        );
                        
                        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
                        return Some(ProcessInfo {
                            pid,
                            ppid: process_entry.th32ParentProcessID,
                            name,
                        });
                    }
                    
                    if !Process32Next(snapshot, &mut process_entry).is_ok() {
                        break;
                    }
                }
            }
            
            let _ = windows::Win32::Foundation::CloseHandle(snapshot);
        }
        
        None
    }

    #[cfg(target_os = "linux")]
    fn get_parent_pid_linux(pid: u32) -> Option<u32> {
        use std::fs;
        
        // Read /proc/[pid]/stat
        let stat_path = format!("/proc/{}/stat", pid);
        match fs::read_to_string(&stat_path) {
            Ok(contents) => {
                // Format: pid (comm) state ppid ...
                // Find the closing parenthesis to skip the command name
                if let Some(close_paren) = contents.rfind(')') {
                    let after_name = &contents[close_paren + 1..];
                    let fields: Vec<&str> = after_name.split_whitespace().collect();
                    
                    // ppid is the second field after the command name
                    if fields.len() > 1 {
                        return fields[1].parse::<u32>().ok();
                    }
                }
            }
            Err(e) => {
                debug!("Failed to read {}: {}", stat_path, e);
            }
        }
        
        None
    }

    #[cfg(target_os = "linux")]
    fn get_process_info_linux(pid: u32) -> Option<ProcessInfo> {
        use std::fs;
        
        // Read /proc/[pid]/stat for ppid
        let ppid = Self::get_parent_pid_linux(pid)?;
        
        // Read /proc/[pid]/comm for process name
        let comm_path = format!("/proc/{}/comm", pid);
        let name = match fs::read_to_string(&comm_path) {
            Ok(contents) => contents.trim().to_string(),
            Err(_) => format!("Process {}", pid),
        };
        
        Some(ProcessInfo { pid, ppid, name })
    }
}

// Platform-specific dependencies
#[cfg(target_os = "macos")]
extern crate libc;