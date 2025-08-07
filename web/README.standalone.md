# VibeTunnel Standalone Server

Run VibeTunnel as a standalone web terminal server without the macOS app. Perfect for remote machines, Docker containers, and quick terminal sharing.

## Quick Start

### Using npx (no installation)

```bash
# Run with no authentication (demo/testing)
npx vibetunnel --no-auth

# Run with Tailscale tunnel
npx vibetunnel --no-auth --enable-tailscale-serve

# Run with custom port
npx vibetunnel --port 8080 --no-auth
```

### Global Installation

```bash
# Install globally
npm install -g vibetunnel

# Run the server
vibetunnel --no-auth
```

### Docker

```bash
# Build the image
docker build -f Dockerfile.standalone -t vibetunnel .

# Run with default settings (no auth, port 4020)
docker run -p 4020:4020 vibetunnel

# Run with Tailscale tunnel
docker run -p 4020:4020 vibetunnel node dist/cli.js --no-auth --enable-tailscale-serve

# Run with manual ngrok (in separate terminal)
docker run -p 4020:4020 vibetunnel node dist/cli.js --no-auth
# Then: ngrok http 4020
```

## CLI Options

### Basic Server Options

- `--port <number>` - Server port (default: 4020)
- `--bind <address>` - Bind address (default: 0.0.0.0)
- `--no-auth` - Disable authentication (for testing)
- `--debug` - Enable debug logging

### Tunnel Options (for remote access)

- `--enable-tailscale-serve` - Enable Tailscale Serve integration
- Use external tools: ngrok, cloudflared, reverse proxy

### Authentication Options

- `--enable-ssh-keys` - Enable SSH key authentication
- `--disallow-user-password` - Disable password auth, SSH keys only
- `--allow-local-bypass` - Allow localhost connections to bypass auth
- `--local-auth-token <token>` - Token for localhost auth bypass

### Network Discovery

- `--no-mdns` - Disable mDNS/Bonjour advertisement

## Use Cases

### Remote Server Access

Access a remote server's terminal through a web browser:

```bash
# Method 1: With Tailscale (if available)
npx vibetunnel --no-auth --enable-tailscale-serve

# Method 2: With external ngrok
npx vibetunnel --no-auth &
ngrok http 4020
# Access the ngrok URL from any browser

# Method 3: With Cloudflare tunnel
npx vibetunnel --no-auth &
cloudflared tunnel --url localhost:4020
```

### Docker Development Environment

Run VibeTunnel in a Docker container for isolated development:

```bash
docker run -d \
  --name vibetunnel \
  -p 4020:4020 \
  vibetunnel
```

### Quick Terminal Sharing

Share your terminal session quickly:

```bash
# With external ngrok
npx vibetunnel --no-auth &
ngrok http 4020

# With Tailscale (if configured)
npx vibetunnel --no-auth --enable-tailscale-serve
```

### Kubernetes Pod Access

Deploy VibeTunnel as a sidecar container for web-based pod access:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-terminal
spec:
  containers:
  - name: main-app
    image: your-app:latest
  - name: vibetunnel
    image: vibetunnel:latest
    ports:
    - containerPort: 4020
    env:
    - name: VIBETUNNEL_NO_AUTH
      value: "true"
```

## Security Considerations

⚠️ **Warning**: The `--no-auth` flag disables all authentication. Only use this for:
- Local development
- Isolated Docker containers
- Networks you fully trust

For production use:
1. Always enable authentication
2. Use HTTPS/TLS (via ngrok or reverse proxy)
3. Consider SSH key authentication with `--enable-ssh-keys`
4. Use environment variables for sensitive configuration

## Environment Variables

- `PORT` - Default port if --port not specified
- `VIBETUNNEL_DEBUG` - Enable debug logging
- `VIBETUNNEL_CONTROL_DIR` - Control directory for session data
- `NGROK_AUTHTOKEN` - Ngrok auth token (alternative to --ngrok-auth)

## Building from Source

```bash
# Clone the repository
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel/web

# Install dependencies
pnpm install

# Build
pnpm run build

# Run
node dist/cli.js --no-auth
```

## Differences from Mac App Version

The standalone server:
- ✅ Runs on any platform (Linux, macOS, Windows via WSL)
- ✅ Works in Docker containers
- ✅ Can be deployed via npx without installation
- ✅ Includes built-in ngrok support
- ❌ No menu bar integration
- ❌ No automatic server management
- ❌ No macOS-specific features (Keychain, etc.)

## Troubleshooting

### Ngrok not starting

- Ensure ngrok is installed: `which ngrok`
- Check if you need an auth token for your use case
- Verify the port is not already in use

### Permission denied errors

- The server needs to spawn PTY processes
- In Docker, you may need `--cap-add SYS_ADMIN`
- Check file permissions in mounted volumes

### Connection refused

- Verify the bind address (use 0.0.0.0 for all interfaces)
- Check firewall rules
- Ensure the port is exposed in Docker

## License

MIT - See LICENSE file for details