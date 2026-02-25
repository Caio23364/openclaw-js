# 🤖 OpenClaw JS — Manual for AI Agents

**Welcome!** If you are an AI Coding Agent (e.g., Claude, GPT-4, Gemini) tasked by the user to modify, review, or debug this project, please treat this document as your primary source of truth for architectural constraints and project conventions.

## 1. Project Identity and Goals
This is **OpenClaw JS** (v2026), a heavily fortified, security-first TypeScript implementation of the personal intelligence ecosystem.
- **Goal:** Zero known vulnerabilities, multi-channel support, multi-provider AI, local-first gateway.
- **Constraints:** Never hardcode secrets. Always validate user inputs via `inputValidator`. Always use the `getMetrics()` system for telemetry. Do not break JSON-RPC protocol compatibility.

## 2. Core Architecture
- **Gateway (`src/gateway/`)**: WebSocket server for Apps / CLI. Handles Auth, Rate Limiting, and JSON-RPC dispatch (`handleRpcRequest`).
- **Agents (`src/agents/`)**: The `AgentRuntime` class manages session TTL, memory bounding, and tool execution.
- **Providers (`src/providers/`)**: `ProviderManager` handles all LLM API calls. Features: `failover.ts`, `media.ts`, `streaming.ts`.
- **Channels (`src/channels/`)**: Independent protocols (WhatsApp, Telegram, etc.). Must not block the event loop.
- **Security (`src/security/`)**: The fortress. Protects against SSRF, brute-force, reverse shells, etc.

## 3. Mandatory Steps Before Committing Code
1. Compile the project with `npx tsc --noEmit`. No TypeScript errors are allowed.
2. Run security unit tests: `npx vitest run test/security.test.ts`.
3. Read `src/types/index.ts` to ensure your data structures match existing global interfaces (like `Message`, `Session`, `AgentConfig`).
4. Handle errors gracefully: use `log.warn()` or `log.error()` imported from `src/utils/logger.js`. Do not swallow exceptions silently.

## 4. Feature Enhancements
- If adding a new **Command**: modify `src/gateway/commands.ts`.
- If adding a new **Provider**: add the class implementing the `Provider` interface and register it in `src/providers/vendors.ts`.
- If adding a new **Channel**: add it to `src/channels/` and update `ChannelManager.ts`.

---

## Appendix A: Dependency Audit Report (Legacy)

**Data:** 2026-02-18  
**Total Dependencies Reduced:** 50 → 23 dependencies | 17 → 11 devDependencies (**55% de redução**)

---

## Dependências Removidas (26 production + 6 dev)

### Production — Sem nenhum import no código

| Pacote | Motivo da remoção |
|--------|-------------------|
| `@google-cloud/dialogflow` | Não usado. O projeto usa `@google/generative-ai` |
| `axios` | Não usado. Node 22+ tem `fetch` nativo |
| `bcryptjs` | Não usado em nenhum arquivo |
| `cheerio` | Não usado em nenhum arquivo |
| `chokidar` | Não usado em nenhum arquivo |
| `cli-table3` | Não usado em nenhum arquivo |
| `dayjs` | Não usado. `Date` nativo é suficiente |
| `dotenv` | Não usado. Node 22+ suporta `--env-file` |
| `fluent-ffmpeg` | Não usado em nenhum arquivo |
| `form-data` | Não usado em nenhum arquivo |
| `glob` | Não usado. Node 22+ tem `fs.glob` |
| `jsdom` | Não usado em nenhum arquivo |
| `jsonwebtoken` | Não usado em nenhum arquivo |
| `marked` | Não usado em nenhum arquivo |
| `mime-types` | Não usado em nenhum arquivo |
| `minimist` | Não usado. `commander` é utilizado |
| `node-fetch` | Não usado. Node 22+ tem `fetch` nativo |
| `nodemailer` | Não usado em nenhum arquivo |
| `playwright` | Não usado. `puppeteer` é utilizado no browser |
| `progress` | Não usado. `ora` é utilizado no CLI |
| `sanitize-html` | Não usado em nenhum arquivo |
| `sharp` | Não usado em nenhum arquivo |
| `twilio` | Não usado em nenhum arquivo |
| `uuid` | Não usado. `crypto.randomUUID()` é utilizado |
| `winston` | Não usado. `pino` é utilizado no logger |
| `zod` | Não usado em nenhum arquivo |

### devDependencies — Types de pacotes removidos

| Pacote | Motivo |
|--------|--------|
| `@types/bcryptjs` | `bcryptjs` removido |
| `@types/fluent-ffmpeg` | `fluent-ffmpeg` removido |
| `@types/jsonwebtoken` | `jsonwebtoken` removido |
| `@types/mime-types` | `mime-types` removido |
| `@types/minimist` | `minimist` removido |
| `@types/sanitize-html` | `sanitize-html` removido |

---

## Dependências Mantidas (23 production + 11 dev)

### AI Providers
| Pacote | Arquivo |
|--------|---------|
| `@anthropic-ai/sdk` | `providers/anthropic.ts` |
| `@google/generative-ai` | `providers/google.ts` |
| `openai` | `providers/openai.ts` |

### Channels
| Pacote | Arquivo |
|--------|---------|
| `@whiskeysockets/baileys` | `channels/whatsapp.ts` |
| `@hapi/boom` | `channels/whatsapp.ts` |
| `qrcode-terminal` | `channels/whatsapp.ts` |
| `grammy` | `channels/telegram.ts` |
| `discord.js` | `channels/discord.ts` |
| `@slack/bolt` | `channels/slack.ts` |
| `matrix-js-sdk` | `channels/matrix.ts` |
| `socket.io` | `channels/webchat.ts`, `gateway/index.ts` |

### Gateway & Core
| Pacote | Arquivo |
|--------|---------|
| `express` | `gateway/index.ts` |
| `cors` | `gateway/index.ts` |
| `ws` | `gateway/index.ts` |
| `node-cron` | `cron/index.ts` |
| `pino` | `utils/logger.ts` |
| `pino-pretty` | `utils/logger.ts` |
| `puppeteer` | `browser/index.ts` |

### CLI
| Pacote | Arquivo |
|--------|---------|
| `commander` | `cli/index.ts` |
| `chalk` | `cli/index.ts` |
| `boxen` | `cli/index.ts` |
| `ora` | `cli/index.ts` |
| `inquirer` | `cli/index.ts` |

---

> **Nota:** Signal (`channels/signal.ts`) não depende de nenhum pacote externo — usa apenas o módulo nativo `child_process` do Node.js para comunicar com `signal-cli`.
