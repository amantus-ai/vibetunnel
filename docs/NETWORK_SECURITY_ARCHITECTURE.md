# VibeTunnel Network Security Architecture

A visual guide to understanding how VibeTunnel's network layers, security boundaries, and Tailscale integration work together.

## The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC INTERNET                                       │
│                    (untrusted, anyone can reach)                             │
│                                                                             │
│   ┌──────────┐                                                              │
│   │ Attacker │ ──── BLOCKED ────┐                                           │
│   └──────────┘                  │                                           │
│                                 ▼                                           │
│   ┌──────────────────────────────────────────────────────┐                  │
│   │              TAILSCALE FUNNEL GATEWAY                │                  │
│   │           (only enabled if you turn it on)           │                  │
│   │                                                      │                  │
│   │  ✓ HTTPS only (TLS termination)                     │                  │
│   │  ✓ Tailscale authentication required                │                  │
│   │  ✓ ACL policies enforced                            │                  │
│   │  ✗ Anonymous access impossible                      │                  │
│   └──────────────────────┬───────────────────────────────┘                  │
│                          │ (authenticated traffic only)                     │
└──────────────────────────┼──────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────────────────┐
│                     TAILSCALE NETWORK (tailnet)                             │
│              (encrypted WireGuard mesh, private to you)                     │
│                                                                             │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐                       │
│   │  Your Mac  │    │ Your iPad  │    │ Your Phone │                       │
│   │  (server)  │    │ (browser)  │    │  (browser) │                       │
│   └─────┬──────┘    └─────┬──────┘    └──────┬─────┘                       │
│         │                 │                   │                              │
│         │    All traffic encrypted end-to-end (WireGuard)                   │
│         │    Each device has unique identity + keys                          │
│         │                 │                   │                              │
│         │                 ▼                   ▼                              │
│         │          ┌─────────────────────────────────┐                      │
│         │          │    TAILSCALE SERVE PROXY        │                      │
│         │          │  https://mac.tailnet.ts.net     │                      │
│         │          │                                 │                      │
│         │          │  ✓ TLS/HTTPS termination        │                      │
│         │          │  ✓ Injects identity headers:    │                      │
│         │          │    - tailscale-user-login        │                      │
│         │          │    - tailscale-user-name         │                      │
│         │          │    - tailscale-user-profile-pic  │                      │
│         │          │  ✓ Only forwards to localhost    │                      │
│         │          └──────────────┬──────────────────┘                      │
│         │                        │                                          │
└─────────┼────────────────────────┼──────────────────────────────────────────┘
          │                        │
┌─────────┼────────────────────────┼──────────────────────────────────────────┐
│         │   YOUR MAC (localhost) │                                           │
│         │   127.0.0.1 only       │                                           │
│         │                        │                                           │
│         │   ┌────────────────────▼────────────────────────────────┐         │
│         │   │           VIBETUNNEL SERVER (:4020)                 │         │
│         │   │           bound to 127.0.0.1                       │         │
│         │   │                                                    │         │
│         │   │  ┌──────────────────────────────────────────────┐  │         │
│         │   │  │         AUTH MIDDLEWARE (gate)                │  │         │
│         │   │  │                                              │  │         │
│         │   │  │  Request arrives → check source:             │  │         │
│         │   │  │                                              │  │         │
│         │   │  │  1. From Tailscale Serve? (localhost +       │  │         │
│         │   │  │     proxy headers) → Trust identity headers  │  │         │
│         │   │  │                                              │  │         │
│         │   │  │  2. From localhost? (no proxy headers)       │  │         │
│         │   │  │     → Local bypass (if enabled)              │  │         │
│         │   │  │     → Or require password/SSH key            │  │         │
│         │   │  │                                              │  │         │
│         │   │  │  3. Has JWT Bearer token?                    │  │         │
│         │   │  │     → Validate token, allow if valid         │  │         │
│         │   │  │                                              │  │         │
│         │   │  │  4. None of the above?                       │  │         │
│         │   │  │     → REJECTED (401 Unauthorized)            │  │         │
│         │   │  └──────────────────────────────────────────────┘  │         │
│         │   │                     │                               │         │
│         │   │                     ▼ (authenticated)               │         │
│         │   │  ┌──────────────────────────────────────────────┐  │         │
│         │   │  │              APPLICATION LAYER               │  │         │
│         │   │  │                                              │  │         │
│         │   │  │  HTTP API: /api/sessions, /api/auth, etc.   │  │         │
│         │   │  │  WebSocket: /ws (terminal I/O, binary)      │  │         │
│         │   │  │  PTY Manager: spawns real terminal shells    │  │         │
│         │   │  └──────────────────────────────────────────────┘  │         │
│         │   └────────────────────────────────────────────────────┘         │
│         │                                                                   │
│   ┌─────▼──────────────────────────────────────────────────────────┐       │
│   │              MACOS APP (Swift/SwiftUI)                          │       │
│   │  - Spawns & manages VibeTunnel server process                  │       │
│   │  - Connects via ws://localhost:4020/ws                         │       │
│   │  - Manages Tailscale Serve lifecycle                           │       │
│   │  - Controls via Unix socket ~/Library/Caches/vibetunnel/api.sock│      │
│   └────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Security Layers Explained

### Layer 1: Network Boundary (What can even reach the server?)

```
                     WHO CAN CONNECT?
                     ─────────────────

  With --enable-tailscale-serve (RECOMMENDED):
  ┌──────────────────────────────────────────────────┐
  │  Server binds to 127.0.0.1 ONLY                  │
  │                                                    │
  │  ✗ Direct access from other machines? IMPOSSIBLE   │
  │  ✗ Access via your Mac's IP?          IMPOSSIBLE   │
  │  ✗ Port scan finds it?                NO           │
  │                                                    │
  │  ✓ Tailscale Serve proxy → localhost?  YES         │
  │  ✓ Mac app → localhost?                YES         │
  │  ✓ Local scripts → localhost?          YES         │
  └──────────────────────────────────────────────────┘

  Without Tailscale Serve (default 0.0.0.0):
  ┌──────────────────────────────────────────────────┐
  │  Server binds to 0.0.0.0 (ALL interfaces)        │
  │                                                    │
  │  ⚠ Anyone on your local network CAN reach :4020   │
  │  ⚠ Depends entirely on auth layer for security    │
  │  → Use --bind 127.0.0.1 to restrict manually      │
  └──────────────────────────────────────────────────┘
```

### Layer 2: Transport Encryption (Is the traffic encrypted?)

```
  ┌────────────────────────────────────────────────────────────┐
  │                  ENCRYPTION STATUS                          │
  │                                                            │
  │  iPad ──── Tailscale (WireGuard) ──── Mac                 │
  │            ✓ ENCRYPTED end-to-end                          │
  │            ✓ TLS on top via Tailscale Serve                │
  │            ✓ Double encrypted (WireGuard + TLS)            │
  │                                                            │
  │  Mac app ──── localhost ──── VibeTunnel server             │
  │               ✗ NOT encrypted (plain HTTP)                 │
  │               ✓ But it never leaves your machine           │
  │               ✓ localhost traffic can't be intercepted     │
  │                  by other machines on the network           │
  │                                                            │
  │  Browser (same Mac) ──── localhost ──── VibeTunnel server  │
  │               ✗ NOT encrypted (plain HTTP)                 │
  │               ✓ Same machine, no network exposure          │
  └────────────────────────────────────────────────────────────┘
```

### Layer 3: Authentication (Who are you?)

```
  ┌────────────────────────────────────────────────────────────────┐
  │                                                                │
  │  VIA TAILSCALE SERVE:                                          │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │  Tailscale already knows who you are (device identity)   │  │
  │  │  → Serve proxy injects: tailscale-user-login header      │  │
  │  │  → Server trusts this ONLY from localhost + proxy combo  │  │
  │  │  → No password needed! Seamless SSO experience           │  │
  │  │  → You see your Tailscale profile pic on the dashboard   │  │
  │  └──────────────────────────────────────────────────────────┘  │
  │                                                                │
  │  VIA DIRECT ACCESS (localhost or LAN):                         │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │  Option A: System password (macOS account password)      │  │
  │  │  Option B: SSH key challenge-response (Ed25519)          │  │
  │  │  Option C: Local bypass (for scripts on same machine)    │  │
  │  │  Option D: No auth (--no-auth, development only!)        │  │
  │  │                                                          │  │
  │  │  → Successful auth → JWT token (24h expiry)              │  │
  │  │  → Token used for all subsequent HTTP & WebSocket calls  │  │
  │  └──────────────────────────────────────────────────────────┘  │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘
```

### Layer 4: Authorization (What can you do?)

```
  ┌──────────────────────────────────────────────────────┐
  │  Once authenticated, you get a terminal shell as     │
  │  the system user you logged in as.                   │
  │                                                      │
  │  ┌────────────────────────────────────────────────┐  │
  │  │  Authenticated user                            │  │
  │  │       │                                        │  │
  │  │       ├── Create terminal sessions             │  │
  │  │       ├── Send input to terminals              │  │
  │  │       ├── Receive terminal output              │  │
  │  │       ├── Resize terminals                     │  │
  │  │       └── Kill terminal sessions               │  │
  │  │                                                │  │
  │  │  The shell runs with YOUR user's permissions   │  │
  │  │  (same as if you opened Terminal.app)           │  │
  │  └────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────┘
```

## Mermaid Diagram: Request Flow

```mermaid
flowchart TB
    subgraph Internet["☁️ Public Internet"]
        ExtUser["External User"]
    end

    subgraph Tailnet["🔒 Tailscale Network (WireGuard encrypted)"]
        iPad["iPad / Phone / Other Device"]

        subgraph Funnel["Tailscale Funnel (optional)"]
            FunnelGW["Funnel Gateway<br/>HTTPS + Auth Required<br/>ACL Policy Enforced"]
        end

        subgraph Serve["Tailscale Serve"]
            ServeProxy["Serve Proxy<br/>TLS termination<br/>Identity header injection<br/>https://mac.tailnet.ts.net"]
        end
    end

    subgraph Mac["💻 Your Mac (localhost only)"]
        subgraph VT["VibeTunnel Server :4020"]
            Auth["Auth Middleware"]
            API["HTTP API + WebSocket"]
            PTY["PTY Manager<br/>(terminal shells)"]
        end
        MacApp["macOS Menu Bar App"]
    end

    ExtUser -->|"HTTPS"| FunnelGW
    FunnelGW -->|"authenticated"| ServeProxy
    iPad -->|"HTTPS<br/>(WireGuard tunnel)"| ServeProxy
    ServeProxy -->|"HTTP + identity headers<br/>to 127.0.0.1:4020"| Auth
    MacApp -->|"ws://localhost:4020/ws<br/>(local bypass)"| Auth
    Auth -->|"verified"| API
    API --> PTY

    style Internet fill:#ffcccc,stroke:#cc0000
    style Tailnet fill:#ccffcc,stroke:#009900
    style Mac fill:#cce5ff,stroke:#0066cc
    style Funnel fill:#ffffcc,stroke:#cc9900
    style Serve fill:#e6ffe6,stroke:#009900
    style VT fill:#e6f0ff,stroke:#0066cc
```

## Mermaid Diagram: What Gets Blocked Where

```mermaid
flowchart LR
    subgraph Blocked["🚫 BLOCKED"]
        A1["Random internet scanner"] -->|"No Funnel"| X1["❌ Can't reach server"]
        A2["LAN neighbor"] -->|"127.0.0.1 binding"| X2["❌ Port not exposed"]
        A3["Spoofed identity headers<br/>from external IP"] -->|"Auth middleware<br/>checks source IP"| X3["❌ Headers ignored"]
    end

    subgraph Allowed["✅ ALLOWED"]
        B1["Your iPad on Tailnet"] -->|"Tailscale Serve"| Y1["✅ Auto-authenticated"]
        B2["Mac app"] -->|"localhost"| Y2["✅ Local bypass"]
        B3["Your browser on Mac"] -->|"localhost + password"| Y3["✅ JWT issued"]
    end

    style Blocked fill:#ffe6e6,stroke:#cc0000
    style Allowed fill:#e6ffe6,stroke:#009900
```

## Common Scenario: "I access VibeTunnel from my iPad"

Here's exactly what happens, step by step:

```
1. Your iPad opens https://mac-name.tailnet.ts.net
        │
        ▼
2. iPad's Tailscale client encrypts the request
   using WireGuard and routes it through the
   Tailscale coordination server to find your Mac
        │
        ▼
3. Your Mac's Tailscale client decrypts the
   WireGuard packet. Traffic arrives at
   Tailscale Serve (running locally).
        │
        ▼
4. Tailscale Serve:
   a) Terminates TLS (HTTPS → HTTP)
   b) Looks up WHO sent this request
      (your iPad's Tailscale identity)
   c) Adds headers:
      tailscale-user-login: you@gmail.com
      tailscale-user-name: Your Name
   d) Forwards to http://127.0.0.1:4020
        │
        ▼
5. VibeTunnel Auth Middleware:
   a) Sees request from 127.0.0.1 ✓
   b) Sees proxy headers present ✓
   c) Sees tailscale-user-login header ✓
   d) Trusts identity → authenticated!
        │
        ▼
6. You see the VibeTunnel dashboard with
   your Tailscale profile picture.
   WebSocket connects for live terminal I/O.
```

## What CANNOT pass through each boundary

| Boundary | What's blocked | Why |
|----------|---------------|-----|
| **Tailscale Network** | Any device not in your tailnet | WireGuard requires cryptographic identity; no key = no connection |
| **Tailscale Funnel** | Unauthenticated public users | Funnel requires Tailscale login; anonymous requests rejected |
| **Tailscale ACLs** | Unauthorized tailnet members | Admin-defined policies control which devices/users can reach which services |
| **Tailscale Serve** | Direct port access from network | Server bound to 127.0.0.1; Serve is the only path in from outside |
| **Auth Middleware** | Spoofed identity headers | Headers only trusted when request comes from localhost WITH proxy indicators |
| **Auth Middleware** | Requests without valid credentials | No token, no password, no SSH key = 401 Unauthorized |
| **PTY Sandbox** | Cross-user terminal access | Shells run as the authenticated user with that user's OS permissions |

## Quick Security Checklist

```
✅ Using --enable-tailscale-serve?
   → Server auto-binds to 127.0.0.1 (safe)
   → HTTPS handled by Tailscale (safe)
   → Identity from Tailscale headers (safe)

⚠️  Using Tailscale Funnel?
   → Public internet can reach your server
   → But ONLY authenticated Tailscale users
   → Review your ACL policies in Tailscale admin

❌ Using --no-auth?
   → Anyone who can reach the port gets a shell
   → ONLY use for local development

❌ Bound to 0.0.0.0 without Tailscale?
   → Your entire LAN can reach port 4020
   → Use --bind 127.0.0.1 or enable Tailscale Serve
```
