# PRD — VK Plugin for Claude Code

**Status:** Draft v0.2
**Owner:** TBD
**Last updated:** 2026-05-14
**References:**
- [Telegram plugin](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/telegram/README.md)
- [Channels reference (code.claude.com)](https://code.claude.com/docs/en/channels-reference)

**Revision notes (v0.2):**
- Configuration and access policy moved to JSON files (no SQLite).
- VK group chats (`peer_id ≥ 2_000_000_000`) supported in v1 with two-layer access (chat allowlist + per-chat sender allowlist) and mention-detection.
- Single HTTP port: **6060** (bound to `127.0.0.1` by default).
- Launch flag corrected: custom plugins go through `--dangerously-load-development-channels` during the research preview; `--channels` is restricted to the Anthropic-curated allowlist. Path to the allowlist documented.
- Added optional **permission relay** (`claude/channel/permission`) so remote VK users can approve/deny tool calls from chat.

---

## 1. Summary

A Claude Code plugin that connects a VK.com community (or, optionally, a user account) to a Claude Code session. Messages sent to the bound VK identity are forwarded into Claude's session as `<channel>` notifications; Claude is given a set of MCP tools to send, edit, react to, and search messages on VK.

The plugin ships as a single Bun process containing:

1. An **MCP server** (stdio transport) — the contract surface for Claude Code.
2. An **ElysiaJS HTTP service** — VK Callback API webhook receiver, local management/admin endpoints, health checks.
3. A **VK client** built on `vk-io`.
4. A **JSON file store** for access policy, paired peers/users, cached VK metadata, and operational state. No database — every persistent file is human-readable JSON that the user can edit by hand, and the server hot-reloads on change.

The plugin mirrors the Telegram plugin's UX (`/vk:configure`, pairing flow, allowlist) and extends it where VK's richer API allows (history, search, reactions, attachments fetched on demand).

---

## 2. Goals

- **Parity with the Telegram plugin.** Same install path (`/plugin install`), same configure-then-pair flow, same `--channels` launch model, same tool ergonomics.
- **Inbound forwarding.** Messages directed at the bound identity are surfaced to Claude with author identity and any attachments resolved to local paths.
- **Outbound assistant actions.** Claude can send, edit, delete, react, mark read, and upload attachments.
- **Use the parts of VK's API that Telegram bots can't reach.** History fetch, message search, and conversation lookup are first-class tools — not a workaround.
- **Local-first, no public URL required by default.** Long Poll is the default transport so the plugin works behind NAT. Callback API mode is opt-in for users who want a webhook.
- **Multi-peer-safe access control.** VK's social graph is broader than a Telegram DM bot's; pairing + allowlist must work for both 1:1 and group chats.
- **First-class group chat support.** Unlike the Telegram plugin (which defers groups to `ACCESS.md`), v1 ships with chat-level + sender-level allowlists and mention-detection, so the bot can sit in a community chat and only react when invoked.

## 3. Non-goals (v1)

- Wall posts, stories, reels, market items.
- Community admin actions (banning, role changes, settings).
- Voice/video calls.
- Multi-account or account-switching in one process. One process binds one VK identity.
- A hosted/cloud version. Plugin runs on the user's machine alongside Claude Code.
- Browser-based OAuth flow for user tokens. v1 supports community tokens (entered manually) only. User tokens are tracked as a v2 stretch.

---

## 4. Users & motivating scenarios

- **The "second self" operator.** Runs a small VK community as a personal endpoint. DMs the community when away from their desk; Claude replies as them, using context from their repo or notes.
- **The community moderator.** Wants Claude to triage incoming community DMs — categorize, react with an emoji, draft replies for human review.
- **The group-chat assistant.** Adds the bot to a 5-person VK group chat. The bot stays silent unless `@`-mentioned, then Claude reads recent history, answers, and can be approved-or-denied on tool calls via remote permission relay.
- **The researcher.** Wants Claude to `search_messages` across a long-running VK conversation to retrieve a link or quote — something the Telegram plugin explicitly cannot do.

---

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Claude Code session                     │
│                                                               │
│   ┌─────────────────────┐         ┌────────────────────────┐ │
│   │ Channel notifier    │◀────────│ MCP tools (stdio)      │ │
│   │ (<channel> blocks)  │         │ send/edit/react/...    │ │
│   │ + permission relay  │         │                        │ │
│   └─────────────────────┘         └────────────────────────┘ │
└────────────▲────────────────────────────────▲────────────────┘
             │                                │
             │ inbound event                  │ tool calls
             │                                │
┌────────────┴────────────────────────────────┴────────────────┐
│                  vk-plugin (Bun process)                      │
│                                                               │
│  ┌────────────────┐   ┌──────────────────┐   ┌─────────────┐ │
│  │ Inbound router │   │ MCP server       │   │ ElysiaJS    │ │
│  │  (long poll OR │──▶│  (stdio)         │   │  :6060      │ │
│  │   webhook)     │   │                  │   │  /webhook   │ │
│  └────────────────┘   └──────────────────┘   │  /admin/*   │ │
│         ▲                     │              │  /healthz   │ │
│         │                     ▼              └──────┬──────┘ │
│  ┌──────┴──────┐       ┌─────────────────────┐     │         │
│  │  vk-io      │       │  JSON file store    │◀────┘         │
│  │  API client │       │  ~/.claude/         │               │
│  │             │       │   channels/vk/      │               │
│  │             │       │     config.json     │               │
│  │             │       │     access.json     │               │
│  │             │       │     peers.json      │               │
│  │             │       │     state.json      │               │
│  └─────────────┘       └─────────────────────┘               │
└────────────▲──────────────────────────────────────────────────┘
             │
             ▼
        VK.com API (api.vk.com)
```

### 5.1 Why ElysiaJS

The MCP server alone is enough for Long Poll mode. ElysiaJS earns its place on a single port (**`127.0.0.1:6060`** by default, configurable via `VK_PORT`) by handling:

- `POST /webhook/vk` — Callback API receiver, including VK's challenge-response confirmation and secret-key validation. Only routed if `VK_TRANSPORT=callback`.
- `GET /healthz`, `GET /readyz` — for users running the plugin under `tmux`, `systemd`, or similar.
- `POST /admin/access/*`, `GET /admin/state`, `GET /admin/config` — surfaced to the slash commands so they don't have to edit JSON files directly. Edits go through Elysia handlers that validate, atomically write, and broadcast a reload to the inbound router.
- Future: a minimal `/admin/ui` static page for managing chat + sender allowlists visually.

Elysia is chosen over Hono / raw `Bun.serve` for end-to-end type inference on routes, native Bun runtime support, and clean validation via Elysia's `t` schemas — which we'll also use to validate VK Callback payloads.

### 5.2 Process model

Single Bun process. Claude Code spawns it under stdio for the MCP transport; the same process binds **`127.0.0.1:6060`** for the Elysia routes (admin + health + optional webhook all on the same port). To expose Callback API to VK, the user fronts `127.0.0.1:6060` with their own reverse proxy (Caddy, Cloudflare Tunnel, ngrok); we never bind `0.0.0.0` unless the user sets `VK_HTTP_BIND=0.0.0.0` and acknowledges the warning.

If port 6060 conflicts, the user overrides via `VK_PORT` or `~/.claude/channels/vk/config.json` → `"port"`.

---

## 6. Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Bun ≥ 1.2** | Same as Telegram plugin prerequisite. Claude Code v2.1.80+ required for channels; v2.1.81+ for permission relay. |
| HTTP | **ElysiaJS** | Webhook receiver + local admin API on port 6060. |
| VK client | **vk-io** | Active, supports community + user tokens, Long Poll, Callback. |
| MCP | **`@modelcontextprotocol/sdk`** (TypeScript) | Stdio transport. Channel capability `experimental.claude/channel`. |
| State | **JSON files** | Atomic writes via tmp + rename; in-process locks; `fs.watch` for hot reload on hand-edits. No SQLite. |
| Validation | **Elysia `t` / TypeBox** | One schema source for HTTP, MCP tool input, and JSON file validation on load. |
| Logging | **Pino** | Pretty in dev, JSON in prod; written to `~/.claude/channels/vk/log/`. |
| Tests | **Bun test** | Colocated as `*.test.ts` next to source. MCP tool tests run against a mock vk-io; JSON store tests use a temp dir. |
| Repo shape | **Bun workspaces monorepo** | `apps/plugin` (the process) + `packages/shared` (reserved for Eden Treaty client when an admin UI ships). Modules pattern inside `apps/plugin/src/modules/`. |
| Lint / format | **prettier + husky + lint-staged** | Reused verbatim from `depvault` — `@ianvs/prettier-plugin-sort-imports` + `prettier-plugin-tailwindcss`, root `prettier.config.js`. |

---

## 7. Repository / plugin layout

The repo is a **Bun workspaces monorepo**. The repo root *is* the plugin root — `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, and `commands/` sit at the top level so Claude Code's plugin loader finds them where it expects. The actual Bun process lives under `apps/plugin/`, organized in a **modules pattern** (feature-cohesive folders, each owning its services, handlers, MCP tools, HTTP routes, types) — same shape as the user's `depvault`/`ogstack` backends. Tests are **colocated** as `*.test.ts` next to the file they cover. Lint/format is **identical to depvault**: root-level `prettier.config.js` with `@ianvs/prettier-plugin-sort-imports` + `prettier-plugin-tailwindcss`, `husky` + `lint-staged` in the root `package.json`.

`packages/shared` is reserved for the Eden Treaty client surface — re-exporting the Elysia app's types so any future `apps/admin-web` consumes routes end-to-end-typed (matching the depvault pattern). It does **not** hold TypeBox schemas: those live next to the modules that own them, and the admin UI never imports schemas directly — it imports the Eden client. Until `apps/admin-web` exists, `packages/shared` stays empty (or absent — add when needed).

The split inside `apps/plugin/src/` is **infrastructure folders vs feature modules**:

- **Infrastructure** (`mcp/`, `state/`, `vk/`, `common/`) — primitives that every feature uses: MCP server lifecycle, JSON store, vk-io client, shared helpers. Infrastructure does not implement features and never imports from `modules/`.
- **Feature modules** (`modules/health/`, `modules/admin/`, `modules/access/`, `modules/inbound/`, `modules/messaging/`, `modules/history/`, `modules/users/`, `modules/permission-relay/`) — each owns a slice of behavior end-to-end: services, schemas, MCP tool implementations, and (when applicable) an Elysia controller. Modules consume infrastructure.
- **`src/app.ts` is the only Elysia composition point.** It boots the MCP server, creates the Elysia app, mounts each module's controller plugin, and binds the listener. There is no separate `http/` infrastructure folder — `health` and `admin` are feature modules like the rest, just with no MCP surface.

```
claude-vk/
├── .claude-plugin/
│   └── plugin.json                       # plugin metadata
├── .mcp.json                             # ${pluginDir}/apps/plugin/src/app.ts
├── README.md
├── ACCESS.md
├── package.json                          # workspaces: ["apps/*", "packages/*"]; husky + lint-staged
├── tsconfig.json                         # root TS config (bundler, strict, ESNext) — same as depvault
├── prettier.config.js                    # reused verbatim from depvault
├── bun.lock
├── docs/
│   └── PRD-vk-plugin.md
├── skills/
│   └── vk/SKILL.md                       # how Claude should use the tools
├── commands/
│   ├── configure.md                      # /vk:configure
│   ├── access.md                         # /vk:access
│   └── status.md                         # /vk:status
├── apps/
│   └── plugin/
│       ├── package.json                  # name: "@claude-vk/plugin"
│       ├── tsconfig.json                 # extends root; paths: { "@/*": ["./src/*"] }
│       ├── bunfig.toml
│       └── src/
│           ├── app.ts                    # entrypoint: load config, boot MCP (stdio), compose Elysia, listen on :6060
│           ├── env.ts                    # env var schema + overrides
│           ├── config.ts                 # config.json loader, hot reload
│           │
│           ├── common/                   # cross-cutting primitives
│           │   ├── logger.ts             # pino instance
│           │   ├── errors.ts             # typed plugin errors
│           │   └── peer.ts               # peer-id helpers (DM vs group chat)
│           │
│           ├── state/                    # JSON file store primitive — no domain knowledge
│           │   ├── json-store.ts         # atomic write, fs.watch hot reload, TypeBox validation
│           │   ├── json-store.test.ts
│           │   └── paths.ts              # ~/.claude/channels/vk/* path resolution
│           │
│           ├── vk/                       # vk-io client primitive — shared by every module that talks to VK
│           │   ├── client.ts             # vk-io wrapper
│           │   ├── rate-limiter.ts       # token bucket (20 req/s)
│           │   └── long-poll.ts          # Updates.startPolling loop + reconnect
│           │
│           ├── mcp/                      # MCP server lifecycle + capability declaration
│           │   ├── server.ts             # creates Server, wires stdio transport
│           │   ├── capabilities.ts       # claude/channel + optional permission capability
│           │   └── register-tools.ts     # calls each module's register fn on startup
│           │
│           └── modules/                  # feature modules
│               ├── health/               # /healthz, /readyz
│               │   └── health.controller.ts
│               │
│               ├── admin/                # cross-cutting /admin/config, /admin/state (everything else lives in its owning module)
│               │   ├── admin.controller.ts
│               │   └── admin.schema.ts
│               │
│               ├── access/               # policy, pairing, two-layer gate, mention detection
│               │   ├── access.controller.ts   # /admin/access/* Elysia plugin
│               │   ├── access.schema.ts       # TypeBox for access.json + admin route payloads
│               │   ├── store.ts               # reads/writes access.json
│               │   ├── policy.ts              # pairing | allowlist | open (per peer-type)
│               │   ├── pairing.ts             # 6-char codes, TTL, single-use
│               │   ├── gate.ts                # chat + sender + activation checks
│               │   ├── gate.test.ts
│               │   ├── mention.ts             # @community / reply-to-bot detection
│               │   └── mention.test.ts
│               │
│               ├── inbound/              # normalize webhook + long-poll → InboundMessage; notify Claude
│               │   ├── inbound.controller.ts  # Elysia plugin for /webhook/vk (mounted only when transport=callback)
│               │   ├── router.ts              # normalize webhook + long-poll into one shape
│               │   ├── router.test.ts
│               │   ├── notifier.ts            # writes <channel> blocks
│               │   ├── attachments.ts         # download inbound attachments to inbox/<peer_id>/<cmid>/
│               │   └── types.ts               # InboundMessage shape
│               │
│               ├── messaging/            # outbound MCP tools that mutate VK (no HTTP surface)
│               │   ├── messaging.tools.ts     # register fn called by mcp/register-tools.ts
│               │   ├── send-message.ts
│               │   ├── send-message.test.ts
│               │   ├── edit-message.ts
│               │   ├── delete-message.ts
│               │   ├── react.ts
│               │   ├── mark-read.ts
│               │   └── upload-attachment.ts   # outbound file upload tool — lives with its siblings
│               │
│               ├── history/              # read-side MCP tools (the VK-vs-Telegram differentiator)
│               │   ├── history.tools.ts
│               │   ├── get-conversation-history.ts
│               │   └── search-messages.ts
│               │
│               ├── users/                # peers.json cache + get_user_info tool
│               │   ├── users.schema.ts   # TypeBox for peers.json
│               │   ├── users.tools.ts
│               │   ├── cache.ts
│               │   ├── cache.test.ts
│               │   └── get-user-info.ts
│               │
│               └── permission-relay/     # opt-in claude/channel/permission handling
│                   ├── handler.ts        # MCP-side: format request → VK DM
│                   ├── verdict.ts        # inbound-side: parse "yes XXXXX" / "no XXXXX"
│                   └── verdict.test.ts
└── packages/
    └── shared/                           # reserved for Eden Treaty client; empty until apps/admin-web exists
```

### 7.1 Module conventions

- **Infrastructure vs module.** `mcp/`, `state/`, `vk/`, `common/` are infrastructure: they own a runtime primitive (MCP server lifecycle, JSON store, vk-io client) or a cross-cutting helper. They do not implement features and they never import from `modules/`. Modules import infrastructure freely.
- **One folder per feature, no further nesting.** A feature module is flat. We do not split a module into `services/` + `routes/` + `tools/` — at this scale that splits files by mechanical role rather than by concern, which is the kind of over-engineering we want to avoid. A module with eight files is fine; a module with eight files and three subfolders is not.
- **File naming inside a module:**
  - `{module}.controller.ts` — Elysia HTTP plugin exporting the module's routes. Example: `access.controller.ts` registers `/admin/access/*`; `inbound.controller.ts` registers `/webhook/vk`; `health.controller.ts` registers `/healthz` + `/readyz`.
  - `{module}.ws.ts` — Elysia WebSocket plugin, if the module needs one. (No module needs one in v1.)
  - `{module}.schema.ts` — TypeBox schemas owned by the module: persistent-file shapes (`access.schema.ts` defines `access.json`), HTTP payloads, and MCP tool input shapes for that module. One file per module — when both an MCP tool and an HTTP route in the same module need a shape, they import it from this file.
  - Everything else uses descriptive kebab-case names: `store.ts`, `gate.ts`, `pairing.ts`, `notifier.ts`, `send-message.ts`. No suffix gymnastics.
- **MCP tools are registered by their owning module.** Each module that exposes tools has a `{module}.tools.ts` whose default export is a `register(server)` function. `src/mcp/register-tools.ts` imports and calls each one on startup. The MCP server itself does not know what tools exist until those calls run.
- **HTTP routes are registered by their owning module.** `src/app.ts` mounts each module's `*.controller.ts` Elysia plugin during startup; there is no separate `http/` folder. The `admin` module owns only the cross-cutting endpoints (`/admin/config`, `/admin/state`) — feature-specific admin endpoints (`/admin/access/*`) live in the feature module itself.
- **`state/` holds *no* schemas.** It's a generic store that takes any TypeBox schema as a validator. Schemas live with the module that owns the data.
- **Tests are colocated** as `<file>.test.ts` next to the source. No separate `tests/` directory. Bun's runner picks them up.
- **No standalone `attachments/` module.** Outbound upload is just another messaging tool (`messaging/upload-attachment.ts`); inbound download is part of the inbound pipeline (`inbound/attachments.ts`). Splitting them out would create a module whose only invariant is "it touches files," which isn't a useful boundary.

### 7.2 Path resolution for `.mcp.json`

Claude Code substitutes **`${CLAUDE_PLUGIN_ROOT}`** inside `.mcp.json` strings — it resolves to the directory holding `.claude-plugin/plugin.json`, which in our layout is the repo root. There is **no** `${claudeHome}` or equivalent substitution; paths under `~/.claude/` must be resolved at runtime in code (`path.join(os.homedir(), '.claude', 'channels', 'vk')`).

The cleanest pattern — matching the official Telegram channel plugin — is to keep `.mcp.json` short and put the actual entrypoint in a `start` script on the root `package.json`. Bun is invoked with `--cwd ${CLAUDE_PLUGIN_ROOT}` so relative paths inside that script resolve correctly:

```json
{
  "mcpServers": {
    "vk": {
      "command": "bun",
      "args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "--silent", "start"]
    }
  }
}
```

Root `package.json` then defines:

```json
{
  "scripts": {
    "start": "bun run apps/plugin/src/app.ts"
  }
}
```

`VK_STATE_DIR` is **not** injected via `.mcp.json` (no substitution exists for `~/.claude`). The plugin reads `process.env.VK_STATE_DIR` if set and otherwise defaults to `path.join(os.homedir(), '.claude', 'channels', 'vk')` in `src/state/paths.ts`.

---

## 8. MCP tools exposed to Claude

| Tool | Purpose | Notes |
|---|---|---|
| `send_message` | Send a message. Takes `peer_id` + `text`, optional `reply_to` (message conversation_id), `files` (absolute paths, ≤50MB each), `keyboard` (JSON for inline buttons). | Auto-chunks text past 4096 chars. Returns `conversation_message_id`. Works for both DM peers (`peer_id` = user id) and group chats (`peer_id ≥ 2_000_000_000`). |
| `edit_message` | Edit a message previously sent by this identity. Takes `peer_id` + `conversation_message_id` + `text`. | Per VK rules, only the sender's own messages, only within 24h. |
| `delete_message` | Delete by `conversation_message_id`. `delete_for_all: bool`. | 24h window for `delete_for_all`. |
| `react` | Add/replace a reaction. `reaction_id` from VK's enumerated set. | Implemented via `messages.sendReaction`. |
| `mark_read` | Mark a peer's messages as read up to a given message. | Useful when Claude is reading history but not replying. |
| `get_conversation_history` | Fetch the last N messages of a peer (default 20, max 200 per call). Returns normalized messages with author, text, attachments resolved to local paths if cached. | This is the headline differentiator vs. Telegram. |
| `search_messages` | `messages.search` — full-text search across the identity's conversations. Returns top-K hits. | Subject to VK API quotas. |
| `get_user_info` | Resolve a `user_id` to display name, screen name, photo URL, online status. | Backed by an in-memory + `peers.json` cache (TTL 1h). |
| `upload_attachment` | Upload a file to VK and return an attachment string (e.g. `photo123_456`) for use with `send_message`. | Separated out so Claude can preview/confirm before sending. |

Tools are validated with TypeBox schemas shared between MCP and the Elysia admin API.

---

## 9. Inbound flow

VK delivers events through two channels. The plugin supports both; users pick one via `VK_TRANSPORT={longpoll|callback}` (default `longpoll`).

> **Architectural note.** The Anthropic channels reference is explicit that the canonical pattern for chat-platform channels is *poll-outward*, no inbound port. Long Poll matches that pattern and is the recommended default. Callback API mode is supported for users who already operate a public endpoint and want webhook-driven delivery, but it is opt-in.

### 9.1 Long Poll (default)

- Uses `vk-io`'s `Updates.startPolling()` against the Bots Long Poll API.
- No public URL required. Works behind NAT, fits the "plugin polls outward" channel pattern.
- Reconnects with exponential backoff on transient errors; surfaces persistent auth errors as a `<channel>` warning to Claude.

### 9.2 Callback API (opt-in)

- Elysia route `POST /webhook/vk` on **port 6060**, bound to `127.0.0.1` — user fronts with their own reverse proxy.
- Validates the body with a TypeBox schema.
- Handles the three confirmation phases: `confirmation` (returns the string from VK admin), `secret` mismatch (rejects with `200 OK` + empty body per VK's rules — never `4xx`, or VK marks the server unhealthy), `event` (processes).
- **Idempotency.** Stores the last 10k event IDs in `state.json` as a ring buffer; events with seen IDs are dropped. The file is rewritten on roll-over (every ~1k new events) rather than on every event to avoid write amplification.

### 9.3 Normalization

Both transports flow into `inbound/router.ts`, which emits a single `InboundMessage` shape:

```ts
type InboundMessage = {
  peer_id: number;                 // chat identity (DM = user_id; group chat ≥ 2e9)
  from_id: number;                 // sender identity — ALWAYS gate on this
  conversation_message_id: number;
  text: string;
  attachments: Attachment[];       // each may have a local_path if downloaded
  reply_to?: number;
  fwd_messages?: InboundMessage[];
  payload?: unknown;               // keyboard callback payloads
  is_group_chat: boolean;          // peer_id >= 2_000_000_000
  mentioned_bot: boolean;          // see §9.5
  received_at: string;             // ISO
};
```

### 9.4 Two-layer access gate (DMs *and* group chats)

The Anthropic channels reference is explicit: **gate on the sender's identity, not the chat or room identity**. In group chats `from_id` and `peer_id` differ, and gating on the room alone would let any member in an allowlisted chat inject prompts into the Claude session.

The plugin enforces this in `inbound/gate.ts`:

1. **Chat layer.** Is this `peer_id` allowed at all? (DM peer or group chat in `access.json → chats`.) If not → drop silently.
2. **Sender layer.** Is `from_id` allowed *for this chat*? Each chat entry has its own sender allowlist. A user being trusted in DM does not grant them trust in a group chat unless explicitly added.
3. **Activation layer (group chats only).** Per the chat's `mention_policy`: forward all messages, only `@`-mentions, or only replies-to-bot. Default `mention_only` to keep the chat quiet.

Pseudocode:

```ts
const chat = access.chats[msg.peer_id];
if (!chat) return drop('chat-not-allowed');
if (!chat.senders.includes(msg.from_id)) return drop('sender-not-allowed');
if (msg.is_group_chat && chat.mention_policy === 'mention_only' && !msg.mentioned_bot) {
  return drop('no-mention');
}
await emit(msg);
```

### 9.5 Mention detection (group chats)

The `mention.ts` module marks `mentioned_bot: true` when **any** of:

- The message text contains `[club{COMMUNITY_ID}|...]` (VK's canonical mention format).
- The message text contains `@<community_screen_name>` (resolved at startup from `groups.getById`).
- The message `reply_to` references a message the bot itself sent (looked up against the recent-message ring in `state.json`).
- The message `payload` carries a keyboard callback from a button the bot rendered.

### 9.6 Forwarding to Claude

The notifier writes a `<channel>` block per the channels reference. `source` is set by Claude Code from the MCP server name (`vk`). Meta attributes:

```
<channel source="vk"
         peer_id="2000000042"
         from_id="123456"
         from_name="ivan_petrov"
         is_group_chat="true"
         conversation_message_id="789"
         mentioned="true">
  Hey bot, can you summarize the standup?
</channel>
```

Claude is instructed (via the MCP server's `instructions` string) to pass `peer_id` back to `send_message` when replying.

Inbound photos/voice/docs are downloaded eagerly to `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/` so Claude can `Read` them.

---

## 10. Setup flow

> **Important — launch flag.** During the Claude Code channels research preview, `--channels` is restricted to plugins on Anthropic's curated allowlist. A user-developed VK plugin is *not* on that allowlist, so the launch command for v1 is **`--dangerously-load-development-channels`**, not `--channels`. The bypass is per-entry and combining it with `--channels` does not extend the bypass. See §16 for the path to graduating onto the official allowlist.

1. **Create a community.** vk.com → Manage → Create community. Type: "Group" (works fine for both DMs and group-chat workflows).
2. **Enable bot capabilities.** Manage → Messages → enable "Community messages." Then "Bot capabilities" → on. To use the bot in multi-user chats, also enable "Allow adding to chats."
3. **Get an access token.** Manage → API usage → Access tokens → create with `messages`, `photos`, `docs`, `manage` scopes.
4. **Get the community ID + screen name** (same screen). Screen name is needed for `@mention` detection.
5. **Install the plugin** (from your marketplace — see §16 on publishing):
   ```
   /plugin marketplace add github:you/your-marketplace
   /plugin install vk@your-marketplace
   /reload-plugins
   ```
6. **Configure.**
   ```
   /vk:configure <community_id> <token>
   ```
   Writes the values into `~/.claude/channels/vk/config.json`. Shell env (`VK_TOKEN`, `VK_COMMUNITY_ID`) takes precedence.
7. **Relaunch with the development channels flag.** Exit your session and start a new one:
   ```
   claude --dangerously-load-development-channels plugin:vk@your-marketplace
   ```
   Claude Code prompts for confirmation on first launch. The plugin will not connect without this flag.
8. **Pair (DM use).** DM the community on VK; the bot replies with a 6-character pairing code. In Claude:
   ```
   /vk:access pair <code>
   ```
   This adds the DM peer to `access.json → chats` with the sender's `user_id` in its sender allowlist.
9. **Pair (group chat use, optional).** Add the bot to a VK group chat. From inside the chat, type `@<community_screen_name> pair` — the bot replies with a 6-character code. In Claude:
   ```
   /vk:access pair <code>
   ```
   Adds the chat's `peer_id` to `access.json → chats` and the *inviting user's* `user_id` to that chat's sender allowlist. Add more allowed senders later with `/vk:access add-sender <peer_id> <user_id>`.
10. **Lock it down.**
    ```
    /vk:access policy allowlist
    ```

For Callback API users, step 6 accepts `--callback https://vk.example.com/webhook/vk` and prints the confirmation string to paste into the VK community's Callback API settings. The webhook serves on `127.0.0.1:6060/webhook/vk`.

---

## 11. Access control

The model is **two-layer**: a chat is either allowed or not, and within each allowed chat there is a list of trusted senders. This is a direct consequence of the channels reference's "gate on sender, not chat" guidance — applied to a platform that has *both*.

### 11.1 Policies

Set per **peer-type** (DM vs group chat), so a user can run an open DM bot while keeping group chats locked down — or vice versa.

| Policy | Behavior |
|---|---|
| `pairing` | Any incoming message from an unknown chat/sender gets a pairing-code reply. Use to onboard new chats/people. **Default for both peer types.** |
| `allowlist` | Only chats listed in `access.json → chats`, and within each, only senders listed in that chat's `senders` array, are forwarded. Anything else is dropped silently. |
| `open` | All messages forwarded. For testing only — `/vk:status` warns. Not allowed for `group_chat` peer type. |

### 11.2 `access.json` schema

Stored at `~/.claude/channels/vk/access.json`, mode `0600`. Hand-editable; server hot-reloads on change (with TypeBox validation — bad edits are rejected with a `<channel>` warning, and the previous version stays live).

```json
{
  "version": 1,
  "policies": {
    "dm": "allowlist",
    "group_chat": "allowlist"
  },
  "chats": {
    "123456": {
      "kind": "dm",
      "title": "Ivan Petrov",
      "senders": [123456],
      "added_at": "2026-05-14T10:21:00Z",
      "added_by": "pairing"
    },
    "2000000042": {
      "kind": "group_chat",
      "title": "Team Standup",
      "senders": [123456, 234567, 345678],
      "mention_policy": "mention_only",
      "added_at": "2026-05-14T11:02:00Z",
      "added_by": "pairing"
    }
  },
  "pending_pairs": {
    "x7k4mq": {
      "peer_id": 2000000099,
      "from_id": 555444,
      "kind": "group_chat",
      "expires_at": "2026-05-14T11:30:00Z"
    }
  }
}
```

Notes:
- Keys under `chats` are stringified `peer_id`s. DM peers are user IDs (`< 2_000_000_000`); group chat peers are `≥ 2_000_000_000` (VK's convention).
- `senders` is an array of VK user IDs. **Pairing populates this with the inviting user only** — additional senders must be explicitly added.
- `mention_policy` (group chats): `"mention_only"` (default), `"all"`, or `"reply_only"`. Controls activation, not access — a non-mention from an allowed sender is gated by activation policy and dropped silently when off.
- `pending_pairs` is the live pairing-code table. TTL 10 min, single-use. Codes are 6 chars from a 32-char alphabet excluding `0/O/1/I/l`.

### 11.3 Group-chat-specific behavior

- **Bot joins:** Group chats appear in `pending_pairs` only after someone in the chat types `@<community> pair`. Until then the bot is silent — VK delivers the messages, but the gate drops them as `chat-not-allowed`.
- **Privacy mode:** The bot needs "Read all messages" permission turned **off** in the community settings unless explicitly desired. When off, VK only delivers messages where the bot is mentioned or replied-to — a nice belt-and-braces alongside the mention-policy gate.
- **Adding senders:** `/vk:access add-sender <peer_id> <user_id_or_screen_name>` resolves screen names via `users.get` and writes the ID.
- **Removing the bot from a chat:** Generates a `chat_kick_user` event; we mark the chat `inactive` (kept for audit) and stop forwarding.

---

## 12. Slash commands

| Command | Action |
|---|---|
| `/vk:configure <community_id> <token> [--callback <url>]` | Writes `config.json`. With `--callback`, prints VK confirmation string. |
| `/vk:access pair <code>` | Consumes a pending pairing code. Adds the originating peer to `chats` and the originating user to that chat's `senders`. |
| `/vk:access policy {dm\|group_chat} {pairing\|allowlist\|open}` | Sets policy per peer-type. `open` rejected for `group_chat`. |
| `/vk:access list [--chats\|--senders <peer_id>]` | Lists allowlisted chats with resolved titles, or senders for a specific chat. |
| `/vk:access add-sender <peer_id> <user_id_or_@screen_name>` | Adds a sender to a chat's allowlist. Resolves screen names. |
| `/vk:access remove-sender <peer_id> <user_id>` | Removes a sender from a chat. |
| `/vk:access remove-chat <peer_id>` | Drops a chat entirely. |
| `/vk:access mention-policy <peer_id> {mention_only\|all\|reply_only}` | Group chats only — controls activation, not access. |
| `/vk:status` | Prints: transport, connection health, community handle, policies, chat count, sender count, last error. |

All commands hit `http://127.0.0.1:6060/admin/*`, so they work even from within skills. The admin API performs validation, atomic write to the relevant JSON file, and signals the inbound router to reload its cached gate.

---

## 13. State, persistence, secrets

All persistent state is JSON. Files are written atomically (write-to-tmp + rename), guarded by an in-process advisory lock, validated against TypeBox schemas on load, and `fs.watch`'d for hot reload on hand-edits. A malformed write is rejected and the previous version stays live.

| File | Mode | Contents |
|---|---|---|
| `~/.claude/channels/vk/config.json` | `0600` | `vk_token`, `vk_community_id`, `vk_community_screen_name`, `transport` (`longpoll`\|`callback`), `port` (default `6060`), `http_bind` (default `127.0.0.1`), `webhook_secret`, `locale`. Environment variables (`VK_*`) override values here. |
| `~/.claude/channels/vk/access.json` | `0600` | Policies, chats, senders, mention policies, pending pair codes. Schema in §11.2. |
| `~/.claude/channels/vk/peers.json` | `0644` | Resolved metadata cache: `{ "users": { "123": { "name": "…", "screen": "…", "cached_at": "…" } }, "groups": { "456": { … } } }`. TTL 1h, refreshed on next reference. Safe to delete; rebuilds on demand. |
| `~/.claude/channels/vk/state.json` | `0644` | Operational: long-poll cursor (`ts`, `pts`), webhook event-ID ring buffer (last 10k), recent-message ring for reply-to-bot detection, connection health timestamps. Safe to delete; the plugin restarts cleanly with a re-fetched cursor. |
| `~/.claude/channels/vk/inbox/` | dir | Downloaded attachments, grouped by `<peer_id>/<cmid>/`. |
| `~/.claude/channels/vk/log/` | dir | Pino logs, rotated daily, 7-day retention. |

`VK_STATE_DIR` overrides the root — same pattern as `TELEGRAM_STATE_DIR` — to run multiple instances on one machine.

**Why JSON over SQLite.** Smaller dependency surface, no migrations, transparent to users editing by hand or grep-ing for a value, trivially version-controllable for backup. The cost is read performance on the peers cache, which we mitigate with an in-process cache; at the volumes a single-user VK community sees, this is comfortably below any threshold where SQLite would pay back its complexity.

**Concurrency.** A single Bun process owns all writes. Reads from the admin HTTP layer go through the same in-memory cache that the inbound router uses; both subscribe to a reload event on file change.

---

## 14. Error handling & rate limits

- Group token: 20 req/sec — enforce via a token-bucket limiter in `vk/client.ts`. Burst 20, refill 20/s.
- VK returns `error_code: 6` (Too many requests) — back off 250ms × attempt, max 5 retries.
- `error_code: 9` (Flood control) on `messages.send` to new peers — return the error to Claude rather than retrying; pairing UX should make this rare.
- Network errors during Long Poll → exponential backoff (1s, 2s, 4s, 8s, capped 30s), then surface as a `<channel>` warning.
- Tool calls that fail return structured errors `{ ok: false, code, message }` so Claude can decide whether to retry or ask the user.

---

## 15. Permission relay (optional, opt-in)

VK is a particularly good fit for `claude/channel/permission`: you're already messaging the bot from your phone, so receiving Claude's tool-approval prompts in the same chat lets you greenlight (or deny) work without returning to the terminal.

### 15.1 Behavior

When Claude tries to use a permission-gated tool (`Bash`, `Write`, `Edit`, etc.), Claude Code:

1. Opens the local terminal dialog as usual.
2. Generates a 5-letter request ID (lowercase, no `l`).
3. Sends a `notifications/claude/channel/permission_request` to our MCP server.

Our server handler formats this into a VK DM to the originating user, e.g.:

```
🔒 Claude wants to run Bash:
   "list files in src/"
   $ ls src/

   Reply "yes a7k4m" or "no a7k4m"
```

The inbound message handler watches every incoming message for the verdict regex `^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`. On match, it emits `notifications/claude/channel/permission` with `{ request_id, behavior }` instead of forwarding the text to Claude. Whichever answers first — terminal or VK — wins; the other side closes.

### 15.2 Capability and safety constraints

- The MCP server declares `experimental.claude/channel/permission: {}` alongside `claude/channel: {}` only when the user opts in via `config.json → "permission_relay": true`. Off by default.
- The channels reference is explicit: **only declare this capability when the channel authenticates the sender** — because anyone who can reply through the channel can approve tool use. Our gate (§9.4) already does, so this is satisfied. We additionally **require** the verdict-sender to be in `access.json` and refuse verdicts from group chats (DMs only — too easy to social-engineer a group).
- If `from_id` does not match the originating-user of the request, the verdict is dropped silently and a `<channel>` warning is emitted to Claude.
- Project-trust and MCP-server-consent dialogs are *not* relayed (per the channels reference). Those continue to require terminal interaction.

---

## 16. Privacy & security

- Token never leaves the local machine. Logged values are redacted by Pino.
- `config.json` is `0600`; `access.json` is `0600`. `peers.json` and `state.json` are `0644` (no secrets).
- Webhook endpoint requires `config.webhook_secret` if set; without it, refuses to start in `callback` mode.
- HTTP listener (port **6060**) bound to `127.0.0.1` only — never exposed unless the user explicitly sets `http_bind` and accepts the warning.
- Pairing codes are 6 chars from a 32-char alphabet (excludes `0/O/1/I/l`), single-use, TTL 10 min.
- Attachments downloaded only from VK CDN domains (allowlisted by host).
- Permission relay (§15) is off by default and refuses verdicts from group chats and from users who didn't originate the request.
- `/vk:status` surfaces whether the token has unnecessary scopes (e.g. `wall`) and warns.

---

## 17. Differences from the Telegram plugin

| Concern | Telegram | VK |
|---|---|---|
| Message history | Not available — bot only sees live messages. | **Available** via `get_conversation_history`. |
| Search | Not available. | **Available** via `search_messages`. |
| Reactions | Fixed whitelist. | Enumerated set, fetched from VK at startup; passed to Claude as part of the tool description. |
| Transport | Bot API (long polling). | Long Poll **or** Callback API. |
| Setup | BotFather + token. | Community + token (no DM-with-a-bot step; community settings UI). |
| HTTP layer | None needed. | **ElysiaJS** on `127.0.0.1:6060` for webhook + admin. |
| Peer IDs | `chat_id` is a single int. | `peer_id` splits user (<2e9) vs group chat (≥2e9). |
| Group chats | Deferred to `ACCESS.md`. | **Supported in v1** with two-layer access and mention-detection. |
| State store | `.env` + access.json. | **All JSON files** (`config.json`, `access.json`, `peers.json`, `state.json`). |
| Permission relay | Available. | **Available** — recommended for VK-from-phone workflow. |
| Launch flag (preview) | `--channels` (allowlisted). | `--dangerously-load-development-channels` until accepted onto the allowlist. |

### Path to the official allowlist

To eventually launch with the unprefixed `--channels` flag, the plugin needs to be added to Anthropic's curated allowlist. The route documented in the channels reference is to submit the plugin to the official marketplace for security review. On Team/Enterprise tenancies, an admin can alternatively add `vk@your-marketplace` to the org's `allowedChannelPlugins` list, which replaces the default Anthropic allowlist for that org.

---

## 18. Milestones

| Milestone | Scope |
|---|---|
| **M0 — Skeleton (1 wk)** | `.claude-plugin/plugin.json`, `.mcp.json`, Bun project, Elysia hello-world on **port 6060**, MCP server declaring `experimental.claude/channel: {}` and exposing a single `ping` tool. End-to-end: `claude --dangerously-load-development-channels plugin:vk@your-marketplace` lights up and `<channel>` events flow. |
| **M1 — Outbound (1 wk)** | `send_message`, `edit_message`, `delete_message`. Manual peer ID. Token bucket limiter. JSON store skeleton (`config.json`, `state.json`). |
| **M2 — Inbound Long Poll + DM (1 wk)** | `vk-io` long poll, inbound router, notifier writing `<channel>` blocks, attachment download. DM-only access gate. |
| **M3 — Access + JSON store (3 days)** | Pairing flow, two-layer allowlist, `/vk:access` commands, hot reload on file change, atomic writes. |
| **M4 — Group chats (4 days)** | `is_group_chat` detection, mention-detection, per-chat sender allowlist, `mention_policy`, group-chat pairing UX. |
| **M5 — Rich tools (1 wk)** | `react`, `mark_read`, `get_conversation_history`, `search_messages`, `get_user_info`, `upload_attachment`. |
| **M6 — Callback API (3 days)** | Elysia `/webhook/vk` route, confirmation handshake, event-ID ring buffer in `state.json`, `/vk:configure --callback` flag. |
| **M7 — Permission relay (3 days)** | `claude/channel/permission` capability, request handler, verdict regex in inbound, originating-user check, DM-only constraint. Opt-in via `config.json`. |
| **M8 — Polish (1 wk)** | `README.md`, `ACCESS.md`, `/vk:status`, error UX, log rotation, dry-run mode, Bun test suite for tools + access gate, allowlist-submission packaging. |
| **v1 release** | All above. ~6–7 weeks. |

---

## 19. Open questions

1. **User tokens.** Should v2 add OAuth-based user-token mode? It enables much more (friends, dialogs across all peers including DMs that aren't with the community), but the OAuth flow is awkward for a local CLI plugin, and VK is increasingly hostile to non-community user-token automation. *Recommendation: defer to v2, document why.*
2. **Allowlist submission.** When do we submit to the official Anthropic marketplace? v1 ships behind `--dangerously-load-development-channels`. Submitting earlier triggers security review and constrains design; later defers the "single-flag" UX win. *Recommendation: post-v1, after at least one external user has shaken out the access gate.*
3. **Keyboards.** VK has inline keyboards (richer than Telegram's). Worth exposing as a first-class param to `send_message`, or leave as a raw JSON pass-through? *Recommendation: raw pass-through in v1, typed schema in v2.*
4. **Voice messages.** VK voice messages decode to OGG/Opus. Transcribe locally via `whisper-cli`, or pass the raw file? *Recommendation: pass raw, document the optional whisper hook in `SKILL.md`.*
5. **Multi-instance discoverability.** If a user runs two instances with `VK_STATE_DIR`, should `/vk:status` see siblings? *Recommendation: no — keep instances isolated.*
6. **Peers cache growth.** `peers.json` could grow unbounded over months in a large community. *Recommendation: enforce 10k-entry LRU eviction; warn at 8k.*

---

## 20. Out of scope (explicit)

- Hosted/SaaS deployment.
- Anything that requires VK's "official app" permissions (call logs, profile edits, money transfers).
- A web admin UI in v1. Slash commands are the admin surface.
- Translation/i18n of the bot's own auto-replies (e.g. the pairing code message). v1 ships Russian + English; the user can override via `config.json → "locale"`.

---

## Appendix A — Plugin manifest files

Channels are registered as MCP servers via `.mcp.json`. Claude Code recognizes them as channels by the `experimental.claude/channel: {}` capability declared in the server itself. `plugin.json` only carries plugin metadata.

**`.claude-plugin/plugin.json`** (metadata only):

```json
{
  "name": "vk",
  "version": "0.1.0",
  "description": "VK.com community bridge for Claude Code",
  "author": "your-name",
  "homepage": "https://github.com/you/claude-vk-plugin"
}
```

**`.mcp.json`** (at repo root, which is also the plugin root — registers the channel server). `${CLAUDE_PLUGIN_ROOT}` is Claude Code's substitution for the directory containing `.claude-plugin/plugin.json`. There is no built-in substitution for `~/.claude/`, so `VK_STATE_DIR` is resolved at runtime in code (defaulted in `src/state/paths.ts`):

```json
{
  "mcpServers": {
    "vk": {
      "command": "bun",
      "args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "--silent", "start"]
    }
  }
}
```

Root `package.json` carries the `start` script:

```json
{
  "scripts": {
    "start": "bun run apps/plugin/src/app.ts"
  }
}
```

Launched via:

```
claude --dangerously-load-development-channels plugin:vk@your-marketplace
```

(Once on the official allowlist, `--channels plugin:vk@claude-plugins-official`.)

## Appendix B — Sample controller and composition

A module-owned controller (the webhook receiver in `inbound`):

```ts
// src/modules/inbound/inbound.controller.ts
import { Elysia, t } from 'elysia';
import { handleVkEvent } from './router';
import { config } from '@/config';

export const inboundController = new Elysia({ prefix: '/webhook' })
  .post('/vk', async ({ body, set }) => {
    if (body.secret && body.secret !== config.webhookSecret) {
      set.status = 200; return 'ok'; // never 4xx — VK marks the server down
    }
    if (body.type === 'confirmation') return config.confirmationString;
    await handleVkEvent(body);
    return 'ok';
  }, {
    body: t.Object({
      type: t.String(),
      group_id: t.Optional(t.Number()),
      secret: t.Optional(t.String()),
      event_id: t.Optional(t.String()),
      object: t.Optional(t.Any()),
    }),
  });
```

`src/app.ts` is the single composition point — it boots MCP and Elysia in one place:

```ts
// src/app.ts
import { Elysia } from 'elysia';
import { config } from './config';
import { startMcpServer } from './mcp/server';
import { healthController } from './modules/health/health.controller';
import { adminController } from './modules/admin/admin.controller';
import { accessController } from './modules/access/access.controller';
import { inboundController } from './modules/inbound/inbound.controller';

await startMcpServer(); // stdio transport — registers tools from each module

const app = new Elysia()
  .use(healthController)
  .use(adminController)
  .use(accessController)
  .use(config.transport === 'callback' ? inboundController : new Elysia())
  .listen({ port: config.port ?? 6060, hostname: config.httpBind ?? '127.0.0.1' });
```

## Appendix C — MCP server capability declaration

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export const mcp = new Server(
  { name: 'vk', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        // declared only when config.permission_relay is true:
        ...(config.permissionRelay ? { 'claude/channel/permission': {} } : {}),
      },
      tools: {},
    },
    instructions:
      'Messages arrive as <channel source="vk" peer_id="…" from_id="…" ' +
      'is_group_chat="…" conversation_message_id="…" mentioned="…">. ' +
      'Reply with send_message, passing peer_id from the tag. ' +
      'In group chats with mentioned="false", do not reply unless the user ' +
      'explicitly asks you to.',
  },
);
```
