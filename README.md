# 🦞 OpenClaw JS — Personal AI Assistant

> Your own personal AI assistant. Any OS. Any Platform. Security-hardened. The lobster way. 🦞 [HARD-FORKED FROM OPENCLAW]

[![Version](https://img.shields.io/badge/version-2026.2.14-blue.svg)](https://github.com/openclaw/openclaw)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![Security](https://img.shields.io/badge/security-hardened-critical.svg)](#security-hardening)
[![Tests](https://img.shields.io/badge/tests-48%2F48-brightgreen.svg)](#tests)

## Highlights

- **[Local-first Gateway](src/gateway/)** — single WebSocket control plane for sessions, channels, tools, and events.
- **[Multi-channel inbox](src/channels/)** — WhatsApp, Telegram, Discord, Slack, Signal, Matrix, WebChat.
- **[Multi-provider AI](src/providers/)** — Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, local models via Ollama.
- **[Security-hardened](src/security/)** — origin validation, rate limiting, challenge-response auth, sandbox, SSRF protection.
- **[Chat commands](src/gateway/commands.ts)** — `/status`, `/think`, `/compact`, `/model`, `/help`, and more.
- **[First-class tools](src/agents/)** — browser automation, cron jobs, sessions, system commands.
- **[Skills platform](src/skills/)** — workspace skills with security auditing.
- **[Mission Control compatible](src/gateway/)** — JSON-RPC protocol for native app connectivity.

## Quick Start

### Prerequisites

- Node.js >= 22.0.0
- npm, pnpm, or yarn

### Configuração (Web UI)

Use o **OpenClaw Configurator** para gerar seu arquivo `.env` de forma visual:

```bash
# Abra o configurator no navegador
open index.html

# Ou acesse online (quando disponível)
```

O configurator inclui:
- 🎨 Interface moderna com dark/light mode
- 🔐 Campos para 15+ provedores de IA
- 💬 Configuração de 7 canais (WhatsApp, Telegram, Discord, etc.)
- ⚙️ Configuração completa do Gateway
- 📦 Exportação para .env, docker-compose.yml, systemd e shell script
- 📥 Importação de arquivos .env existentes

### Install

```bash
git clone https://github.com/openclaw/openclaw-js.git
cd openclaw-js
npm install
npm run build
```

### Start the Gateway

```bash
# Start with defaults (127.0.0.1:18789)
npm run gateway

# With options
openclaw gateway --port 18789 --verbose

# Force-kill existing listener, then start
openclaw gateway --force
```

### Run Security Audit

```bash
# Check your configuration security
openclaw security audit

# Extended checks (verify actual port binding)
openclaw security audit --deep
```

## 📱 Termux (Android)

Run OpenClaw on your Android device via [Termux](https://termux.dev/):

```bash
curl -fsSL https://raw.githubusercontent.com/openclaw/openclaw-js/main/install-termux.sh | bash
```

**One-line installer** — sets up Node.js, clones the repo, installs dependencies, and configures for mobile.

After install:
```bash
# Edit your API keys
nano ~/openclaw-js/.env

# Start OpenClaw
openclaw
```

> **Termux Notes:**
> - Browser automation is disabled (no Chrome on Android)
> - Gateway binds to `0.0.0.0` for network access
> - Use `termux-wake-lock` to keep running in background
> - Add to Termux:Widget for home screen shortcuts

## Supported Channels

### WhatsApp
> Most popular — uses **Baileys** and requires QR pairing.

- Multi-device support via `@whiskeysockets/baileys`
- QR code pairing in terminal
- Media handling (images, video, audio, documents, stickers)
- Message queue with retry
- Group support with mention gating
- Auto-reconnect

```json
{
  "channels": {
    "whatsapp": {
      "default": {
        "sessionName": "openclaw",
        "authStrategy": "local",
        "printQR": true,
        "dmPolicy": "pairing",
        "allowFrom": []
      }
    }
  }
}
```

### Telegram
> Bot API via **grammY** — supports groups, media, locations, contacts.

- Full grammY Bot API integration
- Session management with persistence
- Handles: text, photos, video, voice, audio, documents, stickers, locations, contacts
- Webhook and long-polling modes
- Group support with mention activation
- Auto-reconnect

```json
{
  "channels": {
    "telegram": {
      "default": {
        "botToken": "YOUR_BOT_TOKEN",
        "dmPolicy": "pairing",
        "allowFrom": []
      }
    }
  }
}
```

### Discord
> Discord Bot API + Gateway — supports servers, channels, and DMs.

- Full discord.js integration with Gateway intents
- Guild and channel allowlists/blocklists
- DM policy enforcement (open/pairing/closed)
- Embed support for rich responses
- Media attachments
- Command handling
- Auto-reconnect

```json
{
  "channels": {
    "discord": {
      "default": {
        "discordToken": "YOUR_BOT_TOKEN",
        "dmPolicy": "pairing",
        "allowFrom": [],
        "allowedGuilds": []
      }
    }
  }
}
```

### Additional Channels

| Channel | Library | Status |
|---------|---------|--------|
| **Slack** | `@slack/bolt` | ✅ Full support |
| **Signal** | `signal-cli` (system) | ✅ Full support |
| **Matrix** | `matrix-js-sdk` | ✅ Full support |
| **WebChat** | `socket.io` | ✅ Built-in |

## Chat Commands

Send these in any channel (WhatsApp, Telegram, Discord, etc.):

| Command | Action |
|---------|--------|
| `/status` | Session info — model, tokens, cost |
| `/new` or `/reset` | Reset the session |
| `/compact` | Compact context (keep last 10 messages) |
| `/think <level>` | off \| minimal \| low \| medium \| high \| xhigh |
| `/verbose on\|off` | Toggle verbose mode |
| `/usage off\|tokens\|full` | Per-response usage footer |
| `/model <name>` | Change model (e.g., `/model openai/gpt-4o`) |
| `/activation mention\|always` | Group activation toggle |
| `/restart` | Restart gateway (owner only) |
| `/help` | List all commands |

## Security Hardening

openclaw-js implements **defense-in-depth** security, addressing CVE-2026-25253 and related vulnerabilities.

| Control | Description |
|---------|-------------|
| **Auth by default** | Token authentication enabled, auto-generated 64-char token |
| **Loopback binding** | Gateway binds to `127.0.0.1` by default, not `0.0.0.0` |
| **Origin validation** | WebSocket origin checked against allowlist |
| **Rate limiting** | Per-IP connection + per-client message rate limits |
| **Challenge-response** | Nonce-based authentication handshake |
| **Input validation** | Message size limits, structure validation, prototype pollution detection |
| **Security headers** | CSP, X-Frame-Options, HSTS on all HTTP responses |
| **SSRF protection** | Blocks requests to private IPs and cloud metadata endpoints |
| **SSH hostname defense** | Validates hostnames to prevent injection |
| **PATH sanitization** | Blocks PATH manipulation attacks |
| **Sandbox** | Docker escape detection, reverse shell blocking |
| **Tool approval** | `system.run` requires explicit approval — blocked by default |
| **Config redaction** | `openclaw config` redacts tokens and API keys |
| **Audit logging** | Ring-buffer logger for security events |
| **Tunnel validation** | Custom tunnel commands validated against binary allowlist |

### Security CLI

```bash
# Full security audit
openclaw security audit

# Deep audit (verify network binding)
openclaw security audit --deep

# Rotate auth token
openclaw security rotate-token
```

## Gateway Protocol (Mission Control Compatible)

Connect to `ws://127.0.0.1:18789` using the JSON-RPC protocol:

### Authentication

```json
{ "type": "req", "id": "1", "method": "connect", "params": {
    "auth": { "token": "your-auth-token" },
    "client": { "name": "my-app", "mode": "cli" }
}}
```

Response includes hello-ok snapshot:
```json
{ "type": "res", "id": "1", "ok": true, "payload": {
    "clientId": "...",
    "version": "2026.2.14",
    "protocol": 3,
    "presence": [...],
    "health": { "status": "ok", "uptimeMs": 12345, "sessions": 2 },
    "limits": { "maxMessageSize": 1048576 },
    "policy": { "authMode": "token", "sandbox": true }
}}
```

### RPC Methods

| Method | Description |
|--------|-------------|
| `connect` | Authenticate + get hello-ok snapshot |
| `sessions.list` | List all active sessions |
| `sessions.history` | Get session message history |
| `sessions.send` | Send message (with chat command interception) |
| `sessions.create` | Create a new session |
| `sessions.patch` | Update session settings |
| `sessions.compact` | Compact session context |
| `sessions.reset` | Clear session |
| `agents.list` | List registered agents |
| `node.list` | List connected device nodes |
| `node.describe` | Get node capabilities |
| `node.invoke` | Execute action on device node |
| `ping` | Keepalive |

### Events

| Event | Description |
|-------|-------------|
| `chat` | New message in a session |
| `agent` | Streaming response token |
| `presence` | Client connected/disconnected |

## CLI Reference

| Command | Description |
|---------|-------------|
| `openclaw onboard` | Interactive setup wizard |
| `openclaw gateway [--port] [--verbose]` | Start the gateway |
| `openclaw agent --message "..."` | Talk to the AI |
| `openclaw config [--get key] [--set key --value v]` | Manage config (secrets redacted) |
| `openclaw status` | Show system status |
| `openclaw doctor` | Run diagnostics |
| `openclaw security audit [--deep]` | Security configuration audit |
| `openclaw security rotate-token` | Generate new auth token |
| `openclaw tunnel start [--provider cf\|ngrok\|tailscale]` | Start tunnel |
| `openclaw service install\|start\|stop\|status` | System service management |
| `openclaw memory list\|search\|clear` | Agent memory management |
| `openclaw audit <path>` | Security-audit a skill directory |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `SLACK_SIGNING_SECRET` | Slack signing secret |
| `MATRIX_ACCESS_TOKEN` | Matrix access token |

## Architecture

```
WhatsApp │ Telegram │ Discord │ Slack │ Signal │ Matrix │ WebChat
                              │
                              ▼
               ┌──────────────────────────────┐
               │         Gateway              │
               │   ws://127.0.0.1:18789       │
               │                              │
               │  ┌─ Security ──────────────┐ │
               │  │ Origin │ Rate │ Auth     │ │
               │  │ Input  │ SSRF │ Sandbox  │ │
               │  └─────────────────────────┘ │
               └──────────┬───────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
     Agent Runtime    Sessions        Events
     ┌────────┐      ┌────────┐     ┌────────┐
     │ Tools  │      │ Context│     │  chat  │
     │ Skills │      │ Memory │     │  agent │
     │ Sandbox│      │ Compact│     │presence│
     └───┬────┘      └────────┘     └────────┘
         │
    ┌────┴────────────────────┐
    │       AI Providers      │
    │ Anthropic│OpenAI│Google │
    │ DeepSeek │Ollama│Custom │
    └─────────────────────────┘
```

## Project Structure

```
openclaw-js/
├── src/
│   ├── agents/        # Agent runtime + tools
│   ├── browser/       # Browser automation (Puppeteer)
│   ├── channels/      # WhatsApp, Telegram, Discord, Slack, Signal, Matrix, WebChat
│   ├── cli/           # CLI commands + security audit
│   ├── cron/          # Scheduled tasks
│   ├── gateway/       # WebSocket gateway + chat commands
│   ├── heartbeat/     # Node heartbeat
│   ├── identity/      # Device identity
│   ├── memory/        # Agent memory system
│   ├── metrics/       # Metrics + dashboard
│   ├── providers/     # AI provider adapters
│   ├── runtime/       # Docker runtime
│   ├── security/      # Security module + sandbox
│   ├── service/       # System service management
│   ├── skills/        # Skills platform + audit
│   ├── tunnel/        # Tunnel providers (CF, ngrok, Tailscale)
│   ├── types/         # TypeScript types
│   └── utils/         # Config, logger, helpers
├── test/              # Vitest test suites
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### AI Providers
| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Anthropic Claude |
| `openai` | OpenAI GPT |
| `@google/generative-ai` | Google Gemini |

### Channels
| Package | Purpose |
|---------|---------|
| `@whiskeysockets/baileys` | WhatsApp multi-device API |
| `@hapi/boom` | HTTP error handling (WhatsApp) |
| `qrcode-terminal` | QR code for WhatsApp pairing |
| `grammy` | Telegram Bot API |
| `discord.js` | Discord bot framework |
| `@slack/bolt` | Slack app framework |
| `matrix-js-sdk` | Matrix protocol |
| `socket.io` | WebChat real-time |

### Core
| Package | Purpose |
|---------|---------|
| `express` | HTTP API server |
| `ws` | WebSocket server |
| `cors` | CORS middleware |
| `node-cron` | Scheduled tasks |
| `pino` / `pino-pretty` | Structured logging |
| `puppeteer` | Browser automation |

### CLI
| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `chalk` | Terminal colors |
| `boxen` | Terminal boxes |
| `ora` | Spinners |
| `inquirer` | Interactive prompts |

## Development

```bash
npm install          # Install dependencies
npm run dev          # Development mode
npm run build        # Build for production
npm test             # Run tests (48/48 passing)
npm run lint         # Lint
npm run format       # Format
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm test`)
4. Run security audit (`openclaw security audit`)
5. Commit your changes
6. Open a Pull Request

## 🤖 For AI Agents (Instructions)

If you are an AI assistant tasked with modifying or analyzing this codebase, **read this first**:

1. **Context**: This is **OpenClaw JS**, a security-hardened TypeScript port of the original OpenClaw project. The focus here is on type safety, modular design, and defense-in-depth (Rate limiting, SSRF protection, Origin validation, Sandboxing).
2. **Architecture Map**:
   - `src/gateway/` - The core WebSocket/Express server (`index.ts` is the single source of truth for all incoming connections and RPC methods).
   - `src/channels/` - Integrations (WhatsApp, Discord, Telegram, etc.). They use lazy loading and event emitters.
   - `src/providers/` - AI specific implementations (OpenAI, Anthropic, Google) with fallback, chunking, and streaming wrappers.
   - `src/security/` - Critical security middlewares and configurations. **Do NOT disable these** without explicit human permission.
   - `src/agents/` - Core logic for routing messages, memory management (TTL bounds), tool calling, and session logic.
3. **Key Commands to run before proposing code**:
   - Compilation check: `npx tsc --noEmit` (Must always exit 0).
   - Security tests: `npx vitest run test/security.test.ts`.
4. **Environment**: If you need new tokens or keys, append them to `.env.example`. Do NOT hardcode secrets.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Original [OpenClaw](https://github.com/openclaw/openclaw) project
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp
- [grammY](https://grammy.dev) for Telegram
- [discord.js](https://discord.js.org) for Discord
- [@slack/bolt](https://slack.dev/bolt-js) for Slack
- [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) for Matrix

---

<p align="center">🦞 Made with love — security-hardened fork of OpenClaw</p>
