# ShellOps Docker Usage

Perfect for containerized development and instant terminal access to your code.

## 🚀 Quick Start

```bash
# Build the image
docker build -f Dockerfile.standalone -t shellops .

# Mount your code and get instant tunnel access
docker run -v $(pwd):/workspace -p 4020:4020 shellops --ngrok
```

## 📂 How It Works

1. **Your code** gets mounted to `/workspace` in the container
2. **ShellOps** starts with full dev tools (git, vim, nano, htop, etc.)
3. **Terminal access** via web browser at the tunnel URL
4. **All changes** persist to your local filesystem

## 🌐 Tunnel Options

### Ngrok (Most Popular)
```bash
# Basic ngrok tunnel
docker run -v $(pwd):/workspace -p 4020:4020 shellops --ngrok

# With auth token for reliability
docker run -v $(pwd):/workspace -p 4020:4020 shellops --ngrok --ngrok-auth YOUR_TOKEN

# Custom domain (paid plan)
docker run -v $(pwd):/workspace -p 4020:4020 shellops --ngrok --ngrok-domain custom.ngrok.io
```

### Cloudflare Quick Tunnel (No Auth Required)
```bash
# Free Cloudflare tunnel - no signup needed!
docker run -v $(pwd):/workspace -p 4020:4020 shellops --cloudflare
```

### Local Development (No Tunnel)
```bash
# Local only - no internet access
docker run -v $(pwd):/workspace -p 4020:4020 shellops --no-auth
# Access at http://localhost:4020
```

## 💡 Use Cases

### Remote Development
Work on any machine and access via tunnel:
```bash
# On any server
docker run -v /home/user/project:/workspace -p 4020:4020 shellops --ngrok
# Share URL with team for collaboration
```

### Docker Compose Development
```yaml
version: '3'
services:
  app:
    image: your-app:latest
    volumes:
      - ./:/app
  
  terminal:
    image: shellops:latest
    command: ["--cloudflare"]
    ports:
      - "4020:4020"
    volumes:
      - ./:/workspace
```

### Kubernetes Debugging
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: debug-pod
spec:
  containers:
  - name: app
    image: your-app:latest
    volumeMounts:
    - name: code
      mountPath: /app
  - name: terminal
    image: shellops:latest
    args: ["--cloudflare"]
    ports:
    - containerPort: 4020
    volumeMounts:
    - name: code
      mountPath: /workspace
  volumes:
  - name: code
    configMap:
      name: app-source
```

### Teaching & Workshops
```bash
# Instructor shares live coding environment
docker run -v $(pwd):/workspace -p 4020:4020 shellops --ngrok
# Students access via shared URL - no setup required!
```

## 🔧 Container Features

### Pre-installed Tools
- **Languages**: Node.js 20, Python 3
- **Editors**: vim, nano
- **Utils**: git, curl, wget, htop, tree, jq
- **Tunnels**: ngrok, cloudflared
- **Dev Tools**: pnpm, typescript, ts-node, nodemon

### Smart Entrypoint
- Shows helpful usage if no args provided
- Passes all arguments to ShellOps
- Automatically binds to 0.0.0.0 for container access

### Environment
- Working directory: `/workspace` (mount your code here)
- PATH includes `/workspace/node_modules/.bin` 
- Node.js tools available globally

## 🛡️ Security Notes

- `--no-auth` disables authentication (only use for development)
- For production, use proper authentication methods
- Tunnel URLs are public - be careful with sensitive data
- Consider using `--enable-ssh-keys` for better security

## 🎯 Perfect For

- **Remote pair programming**
- **Code reviews in real-time**
- **Teaching programming**
- **Debugging in containers**
- **Quick server access**
- **Team collaboration**
- **Live demonstrations**

Your code stays local, but terminal access is global! 🌍