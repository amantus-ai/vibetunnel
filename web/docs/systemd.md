# ShellOps Systemd Service Guide

This guide covers installing and managing ShellOps as a systemd service on Linux systems.

## Overview

ShellOps includes built-in systemd integration that allows you to run it as a persistent service on Linux. The service runs as a **user-level systemd service** under your account (not system-wide), providing automatic startup, restart on failure, and proper resource management.

## Quick Start

```bash
# Install the systemd service (run as regular user, NOT root)
shellops systemd

# Start the service
systemctl --user start shellops

# Enable auto-start on boot
systemctl --user enable shellops

# Check status
systemctl --user status shellops
```

## Installation

### Prerequisites

- Linux system with systemd (most modern distributions)
- ShellOps installed globally via npm (`npm install -g shellops`)
- Regular user account (do not run as root)

### Install Command

```bash
shellops systemd
```

This command will:
1. Verify ShellOps is installed and accessible
2. Create a wrapper script at `~/.local/bin/shellops-systemd`
3. Install the service file at `~/.config/systemd/user/shellops.service`
4. Enable the service for automatic startup
5. Configure user lingering for boot startup

## Service Management

### Basic Commands

```bash
# Start the service
systemctl --user start shellops

# Stop the service
systemctl --user stop shellops

# Restart the service
systemctl --user restart shellops

# Check service status
systemctl --user status shellops

# Enable auto-start
systemctl --user enable shellops

# Disable auto-start
systemctl --user disable shellops

# Check ShellOps's systemd status
shellops systemd status
```

### Viewing Logs

```bash
# Follow logs in real-time
journalctl --user -u shellops -f

# View all logs
journalctl --user -u shellops

# View logs from the last hour
journalctl --user -u shellops --since "1 hour ago"

# View only error messages
journalctl --user -u shellops -p err
```

## Configuration

### Default Settings

The service runs with these defaults:
- **Port**: 4020
- **Bind Address**: 0.0.0.0 (all interfaces)
- **Working Directory**: Your home directory
- **Restart Policy**: Always restart on failure
- **Restart Delay**: 10 seconds
- **Memory Limit**: 512MB soft, 1GB hard
- **File Descriptor Limit**: 65536
- **Environment**: `NODE_ENV=production`, `SHELLOPS_LOG_LEVEL=info`

### Service File Location

The service configuration is stored at:
```
~/.config/systemd/user/shellops.service
```

### Customizing the Service

To modify service settings:

1. Edit the service file:
   ```bash
   nano ~/.config/systemd/user/shellops.service
   ```

2. Common customizations:
   ```ini
   # Change port
   ExecStart=/home/user/.local/bin/shellops-systemd --port 8080 --bind 0.0.0.0

   # Add authentication
   ExecStart=/home/user/.local/bin/shellops-systemd --port 4020 --bind 0.0.0.0 --auth system

   # Change log level
   Environment=SHELLOPS_LOG_LEVEL=debug

   # Adjust memory limits
   MemoryHigh=1G
   MemoryMax=2G

   # Add custom environment variables
   Environment=MY_CUSTOM_VAR=value
   ```

3. Reload and restart:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart shellops
   ```

## Architecture

### Why User-Level Service?

ShellOps uses user-level systemd services for several reasons:

1. **Security**: Runs with user privileges, not root
2. **Node.js Compatibility**: Works with user-installed Node.js version managers (nvm, fnm)
3. **User Data Access**: Natural access to your projects and Git repositories
4. **Simplicity**: No sudo required for management
5. **Isolation**: Each user can run their own instance

### The Wrapper Script

The installer creates a wrapper script at `~/.local/bin/shellops-systemd` that:
- Searches for ShellOps in multiple locations
- Handles nvm and fnm installations
- Falls back to system-wide Node.js if needed
- Provides detailed logging for troubleshooting

### User Lingering

The installer enables "user lingering" which allows your user services to run even when you're not logged in:

```bash
# This is done automatically during installation
loginctl enable-linger $USER

# To check lingering status
loginctl show-user $USER | grep Linger

# To disable lingering (if desired)
loginctl disable-linger $USER
```

## Troubleshooting

### Service Won't Start

1. Check if ShellOps is installed:
   ```bash
   which shellops
   ```

2. Check service logs:
   ```bash
   journalctl --user -u shellops -n 50
   ```

3. Verify the wrapper script exists:
   ```bash
   ls -la ~/.local/bin/shellops-systemd
   ```

4. Test the wrapper script directly:
   ```bash
   ~/.local/bin/shellops-systemd --version
   ```

### Port Already in Use

If port 4020 is already in use:

1. Find what's using the port:
   ```bash
   lsof -i :4020
   ```

2. Either stop the conflicting service or change ShellOps's port in the service file

### Node.js Version Manager Issues

If using nvm or fnm, ensure they're properly initialized:

1. Check your shell configuration:
   ```bash
   # For nvm
   echo $NVM_DIR
   
   # For fnm
   echo $FNM_DIR
   ```

2. The wrapper script searches these locations:
   - nvm: `~/.nvm`
   - fnm: `~/.local/share/fnm`
   - Global npm: `/usr/local/bin/npm`, `/usr/bin/npm`

### Permission Denied

If you get permission errors:

1. Ensure you're NOT running as root
2. Check file permissions:
   ```bash
   ls -la ~/.config/systemd/user/
   ls -la ~/.local/bin/shellops-systemd
   ```

3. Fix permissions if needed:
   ```bash
   chmod 755 ~/.local/bin/shellops-systemd
   chmod 644 ~/.config/systemd/user/shellops.service
   ```

## Uninstallation

To completely remove the systemd service:

```bash
# Stop and disable the service
systemctl --user stop shellops
systemctl --user disable shellops

# Remove service files
shellops systemd uninstall

# Optional: Disable user lingering
loginctl disable-linger $USER
```

This will:
- Stop the running service
- Disable automatic startup
- Remove the service file
- Remove the wrapper script
- Reload systemd configuration

## Advanced Usage

### Multiple Instances

To run multiple ShellOps instances:

1. Copy the service file with a new name:
   ```bash
   cp ~/.config/systemd/user/shellops.service ~/.config/systemd/user/shellops-dev.service
   ```

2. Edit the new service file to use a different port:
   ```ini
   ExecStart=/home/user/.local/bin/shellops-systemd --port 4021 --bind 0.0.0.0
   ```

3. Manage the new instance:
   ```bash
   systemctl --user daemon-reload
   systemctl --user start shellops-dev
   ```

### Environment-Specific Configuration

Create environment-specific service overrides:

```bash
# Create override directory
mkdir -p ~/.config/systemd/user/shellops.service.d/

# Create override file
cat > ~/.config/systemd/user/shellops.service.d/override.conf << EOF
[Service]
Environment=NODE_ENV=development
Environment=SHELLOPS_LOG_LEVEL=debug
ExecStart=
ExecStart=/home/user/.local/bin/shellops-systemd --port 4020 --bind 127.0.0.1
EOF

# Reload and restart
systemctl --user daemon-reload
systemctl --user restart shellops
```

### Integration with Other Services

To make ShellOps depend on other services:

```ini
[Unit]
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
# ... rest of configuration
```

## Security Considerations

### Firewall Configuration

If binding to 0.0.0.0, ensure your firewall is properly configured:

```bash
# UFW example
sudo ufw allow 4020/tcp

# firewalld example
sudo firewall-cmd --add-port=4020/tcp --permanent
sudo firewall-cmd --reload
```

### Restricting Access

To limit access to localhost only, modify the service:

```ini
ExecStart=/home/user/.local/bin/shellops-systemd --port 4020 --bind 127.0.0.1
```

### Resource Limits

The service includes resource limits for stability:
- Memory: 512MB soft limit, 1GB hard limit
- File descriptors: 65536
- Automatic restart with 10-second delay

Adjust these based on your needs and system resources.

## FAQ

**Q: Why doesn't the service run as root?**
A: ShellOps doesn't require root privileges and running as a regular user is more secure. It also ensures compatibility with user-installed Node.js version managers.

**Q: Can I run this on a server without a GUI?**
A: Yes, the systemd service works perfectly on headless servers. User lingering ensures it starts at boot.

**Q: How do I run ShellOps on a different port?**
A: Edit the service file and change the `--port` parameter in the `ExecStart` line, then reload and restart.

**Q: What if I use a custom Node.js installation?**
A: The wrapper script searches common locations. If your installation isn't found, you can modify the wrapper script at `~/.local/bin/shellops-systemd`.

**Q: Can multiple users run ShellOps on the same system?**
A: Yes, each user can install their own service. Just ensure they use different ports.

## Support

For issues specific to the systemd service:
1. Check the logs with `journalctl --user -u shellops`
2. Verify the installation with `shellops systemd status`
3. Report issues at https://github.com/amantus-ai/shellops/issues