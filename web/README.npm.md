# VibeTunnel - Web Terminal Server

Run terminal sessions in your browser. Perfect for remote access, Docker containers, and quick terminal sharing via ngrok.

[![npm version](https://img.shields.io/npm/v/vibetunnel.svg)](https://www.npmjs.com/package/vibetunnel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Start

No installation needed - run instantly with npx:

```bash
# Start local server (no auth)
npx vibetunnel --no-auth

# Start with ngrok tunnel for remote access
npx vibetunnel --no-auth --ngrok

# Custom port
npx vibetunnel --port 8080 --no-auth
```

Then open http://localhost:4020 in your browser.

## 📦 Installation

### Global Install

```bash
npm install -g vibetunnel

# Run the server
vibetunnel --no-auth
```

### Docker

```bash
# Build from source
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel/web
docker build -f Dockerfile.standalone -t vibetunnel .

# Mount your code and run with tunnel
docker run -v $(pwd):/workspace -p 4020:4020 vibetunnel --ngrok

# Or with Cloudflare tunnel
docker run -v $(pwd):/workspace -p 4020:4020 vibetunnel --cloudflare
```

## 🌐 Remote Access with Ngrok

Share your terminal with anyone on the internet:

```bash
# With built-in Tailscale Serve  
npx vibetunnel --no-auth --enable-tailscale-serve

# With external ngrok (run separately)
npx vibetunnel --no-auth &
ngrok http 4020

# With Cloudflare tunnel
npx vibetunnel --no-auth &
cloudflared tunnel --url localhost:4020
```


## 🔧 CLI Options

### Server Options
- `--port <number>` - Server port (default: 4020)
- `--bind <address>` - Bind address (default: 0.0.0.0)
- `--debug` - Enable debug logging

### Authentication
- `--no-auth` - Disable authentication (⚠️ use only for testing)
- `--enable-ssh-keys` - Enable SSH key authentication
- `--disallow-user-password` - SSH keys only, no passwords

### Tunnel Options
- `--ngrok` - Enable ngrok tunnel
- `--ngrok-auth <token>` - Ngrok auth token
- `--ngrok-domain <domain>` - Custom domain
- `--ngrok-region <region>` - Region: us, eu, ap, au, sa, jp, in
- `--cloudflare` - Enable Cloudflare Quick Tunnel (no auth)

## 💡 Use Cases

### Remote Server Management

Access any server's terminal through a browser:

```bash
ssh remote-server
npx vibetunnel --no-auth --ngrok
# Share the ngrok URL with your team
```

### Docker Development

Add terminal access to any container:

```yaml
version: '3'
services:
  app:
    image: vibetunnel:latest
    command: ["--ngrok"]
    ports:
      - "4020:4020"
    volumes:
      - "./:/workspace"
```

### Kubernetes Debugging

Deploy as a sidecar for pod debugging:

```yaml
containers:
- name: main-app
  image: your-app:latest
- name: terminal
  image: node:24-trixie-slim
  command: ["npx", "vibetunnel", "--no-auth"]
  ports:
  - containerPort: 4020
```

### Teaching & Demos

Share your terminal for live coding sessions:

```bash
npx vibetunnel --no-auth --ngrok
# Share URL with students
```

## 🔒 Security

⚠️ **Important Security Notes:**

1. **Never use `--no-auth` in production** - it disables all authentication
2. **Always use HTTPS in production** - either via ngrok or a reverse proxy
3. **Consider SSH key authentication** for better security
4. **Use environment variables** for sensitive configuration

### Production Setup

```bash
# With system authentication (uses PAM)
vibetunnel

# With SSH keys only
vibetunnel --enable-ssh-keys --disallow-user-password

# Behind reverse proxy (nginx/caddy)
vibetunnel --bind 127.0.0.1
```

## 🛠️ Advanced Configuration

### Environment Variables

- `PORT` - Default port (overrides 4020)
- `VIBETUNNEL_DEBUG` - Enable debug logging
- `NGROK_AUTHTOKEN` - Ngrok auth token

### Custom Configuration

Create `~/.vibetunnel/config.json`:

```json
{
  "port": 8080,
  "authentication": {
    "sshKeysEnabled": true
  },
  "remoteAccess": {
    "ngrokEnabled": true
  }
}
```

## 📚 Full Documentation

- [Standalone Usage Guide](https://github.com/amantus-ai/vibetunnel/blob/main/web/README.standalone.md)
- [Main Repository](https://github.com/amantus-ai/vibetunnel)
- [Report Issues](https://github.com/amantus-ai/vibetunnel/issues)

## 🤝 Contributing

Contributions welcome! Please check the [main repository](https://github.com/amantus-ai/vibetunnel) for guidelines.

## 📄 License

MIT - See [LICENSE](https://github.com/amantus-ai/vibetunnel/blob/main/LICENSE) for details.

---

**Note:** This is the standalone web server version of VibeTunnel. For the full macOS app experience with menu bar integration, see the [main project](https://github.com/amantus-ai/vibetunnel).
