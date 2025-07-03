# VibeTunnel Security Analysis

## Overview

This document provides a comprehensive analysis of VibeTunnel's authentication and security implementation. The analysis focuses on the web server component which handles API endpoints and terminal session management.

## Authentication System

### 1. Authentication Methods

VibeTunnel supports multiple authentication methods:

- **SSH Key Authentication** (Priority method)
  - Uses challenge-response mechanism
  - Verifies Ed25519 signatures
  - Checks against user's `~/.ssh/authorized_keys`
  
- **Password Authentication** (Fallback method)
  - PAM authentication for system users
  - Environment variable authentication (`VIBETUNNEL_USERNAME`/`VIBETUNNEL_PASSWORD`)
  
- **Bearer Token Authentication**
  - Used for HQ-to-remote server communication
  - UUID-based tokens generated per remote server
  
- **Local Bypass Authentication**
  - Optional feature for localhost connections
  - Can require a token (`--local-auth-token`)
  
- **No Authentication Mode**
  - Disabled by default
  - Enable with `--no-auth` flag

### 2. JWT Token Management

- **Token Generation**: JWT tokens are issued after successful authentication
- **Token Expiry**: 24-hour expiration
- **JWT Secret**: Either from `JWT_SECRET` environment variable or auto-generated
- **Token Verification**: All protected endpoints verify JWT tokens

### 3. Authentication Middleware

Located in `/web/src/server/middleware/auth.ts`:

- **Exempt Endpoints**: `/auth/*`, `/logs/*`, `/push/*` (no authentication required)
- **Token Sources**: 
  - Bearer token in Authorization header
  - Query parameter `?token=` for EventSource connections
- **Request Enhancement**: Adds `userId` and `authMethod` to authenticated requests

## Protected Endpoints

### API Routes Requiring Authentication

All routes under `/api/*` require authentication except:
- `/api/auth/*` - Authentication endpoints
- `/api/health` - Health check endpoint
- `/api/logs/*` - Client logging endpoints
- `/api/push/*` - Push notification endpoints

### Critical Protected Endpoints

1. **Session Management** (`/api/sessions/*`)
   - Create, list, and manage terminal sessions
   - Input/output streaming
   - Session resizing and control

2. **File System Access** (`/api/filesystem/*`)
   - **CRITICAL**: Full filesystem access with no path restrictions
   - Browse directories
   - Read/download files
   - Get Git status information

3. **File Operations** (`/api/files/*`)
   - Upload files to the server
   - File management operations

4. **Screen Capture** (`/api/screencap/*`)
   - Screen sharing functionality
   - Remote screen control
   - Mouse and keyboard input

5. **Remote Management** (`/api/remotes/*`)
   - HQ mode: Manage remote servers
   - Register/unregister remote instances

## Security Concerns

### 1. Unrestricted File System Access

**CRITICAL ISSUE**: The filesystem routes have disabled path safety checks:

```typescript
// Helper to check if path is safe (no directory traversal) - DISABLED for full filesystem access
function isPathSafe(_requestedPath: string, _basePath: string): boolean {
    // Security check disabled - allow access to all directories
    return true;
}
```

This allows authenticated users to:
- Browse ANY directory on the system
- Download ANY file they have OS-level permissions to read
- View Git repository information

### 2. Full Terminal Access

Authenticated users can:
- Create terminal sessions with any shell
- Execute any commands
- Change to any directory
- Access system resources

### 3. Screen Sharing Access

The screencap functionality allows:
- Full screen capture
- Remote mouse/keyboard control
- No additional permission checks beyond authentication

### 4. Sensitive Information Exposure

- User avatars endpoint (`/api/auth/avatar/:userId`) can enumerate system users
- Git status reveals repository structure and changes
- Process information exposed through terminal sessions

## Security Recommendations

### 1. Implement Path Restrictions
- Re-enable path safety checks in filesystem routes
- Limit file access to specific directories
- Implement allowlist/denylist for file operations

### 2. Add Role-Based Access Control (RBAC)
- Differentiate between admin and regular users
- Limit sensitive operations to admin users
- Add per-endpoint permission checks

### 3. Implement Session Restrictions
- Limit shell types that can be spawned
- Restrict commands that can be executed
- Add resource limits (CPU, memory, time)

### 4. Add Audit Logging
- Log all authentication attempts
- Track file access and downloads
- Monitor command execution
- Record screen sharing sessions

### 5. Enhance Token Security
- Implement token refresh mechanism
- Add token revocation/blacklisting
- Use shorter expiration times for sensitive operations
- Consider using asymmetric keys for JWT

### 6. Add Rate Limiting
- Limit authentication attempts
- Restrict API call frequency
- Prevent brute force attacks

### 7. Implement Additional Security Headers
- Add CORS restrictions
- Implement CSP headers
- Use secure cookie flags

## Configuration Security

### Environment Variables
- `JWT_SECRET`: Should be set to a strong, random value
- `VIBETUNNEL_USERNAME/PASSWORD`: Should use strong credentials
- Avoid storing sensitive data in environment variables in production

### Command Line Options
- `--no-auth`: Should never be used in production
- `--allow-local-bypass`: Use with caution
- `--allow-insecure-hq`: Avoid in production (allows HTTP for HQ communication)

## Conclusion

VibeTunnel provides powerful remote access capabilities but with significant security implications. The current implementation prioritizes functionality over security restrictions. For production use, especially in multi-user or internet-facing deployments, implementing the recommended security enhancements is critical to prevent unauthorized access and potential system compromise.

The authentication system itself is well-implemented with JWT tokens and multiple auth methods, but the lack of granular access controls and unrestricted system access poses significant risks.