# PRD — VK Plugin for Claude Code

**Status:** Draft v0.4
**Owner:** TBD
**Last updated:** 2026-05-15
**References:**

- [Telegram plugin](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/telegram/README.md)
- [Channels reference (code.claude.com)](https://code.claude.com/docs/en/channels-reference)
- [VK Bots Long Poll API](https://dev.vk.com/ru/api/bots-long-poll/getting-started)

**Revision notes (v0.4):**

- Callback API removed. **VK Bots Long Poll is the only inbound transport.** No public URL, no reverse proxy required. `vk-io`'s `updates.start()` owns the poll cursor and key refresh; we wrap it with a connect-backoff loop.
- `VK_WEBHOOK_SECRET`, `VK_WEBHOOK_CONFIRMATION`, and `VK_HTTP_BIND` env vars are gone. The Elysia listener is hard-bound to `127.0.0.1` (admin + health only).
- `EventIdDedup` removed — long poll does not retry-deliver events, so the in-memory dedup ring is unnecessary.
- `/webhook/vk` HTTP route deleted along with `webhook.service.ts`, `webhook.schema.ts`, `event-dedup.ts`, and `inbound.controller.ts`. `webhook-adapter.ts` is now transport-agnostic `message-adapter.ts`.

**Revision notes (v0.3):**

- Permission relay is **always on** — the `claude/channel/permission` capability is unconditionally advertised. No opt-in flag.
- Community `id` + `screen_name` are auto-resolved at startup via `groups.getById`; no longer require `VK_COMMUNITY_ID` / `VK_COMMUNITY_SCREEN_NAME` env vars.
- `state.json` and `config.json` are gone. Only `access.json` and `peers.json` are persisted. Recent-sent-cmid tracking lives in an in-memory ring (`RecentSentMessages`).
- DM `open` policy removed. Both peer types use `pairing` (default) or `allowlist`.
- `VK_LOCALE` removed; pairing-prompt copy is English only.
- `VK_STATE_DIR` removed; state dir is always `~/.claude/channels/vk`.

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
2. An **ElysiaJS HTTP service** — local management/admin endpoints + health checks, bound to `127.0.0.1`. No inbound HTTP surface.
3. A **VK client** built on `vk-io`, which also owns the **Bots Long Poll** loop for inbound `message_new` events.
4. A **JSON file store** for access policy and cached VK metadata. No database — both files are human-readable JSON the user can edit by hand, and the server hot-reloads `access.json` on change.

The plugin mirrors the Telegram plugin's UX (`/vk:configure`, pairing flow, allowlist) and extends it where VK's richer API allows (history, search, reactions, attachments fetched on demand).

---

## 2. Goals

- **Parity with the Telegram plugin.** Same install path (`/plugin install`), same configure-then-pair flow, same `--channels` launch model, same tool ergonomics.
- **Inbound forwarding.** Messages directed at the bound identity are surfaced to Claude with author identity and any attachments resolved to local paths.
- **Outbound assistant actions.** Claude can send, edit, delete, react, mark read, and upload attachments.
- **Use the parts of VK's API that Telegram bots can't reach.** History fetch, message search, and conversation lookup are first-class tools — not a workaround.
- **Long-poll inbound.** VK Bots Long Poll is the only transport. No public URL, no reverse proxy, works behind NAT. `vk-io` owns the poll cursor + key refresh; we wrap it with a connect-backoff loop and a `message_new` handler.
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
│  │ Long-poll loop │──▶│ MCP server       │   │ ElysiaJS    │ │
│  │  (vk-io        │   │  (stdio)         │   │  127.0.0.1  │ │
│  │   updates)     │   │                  │   │  :6060      │ │
│  └────────┬───────┘   └──────────────────┘   │  /access/*  │ │
│           │                   │              │  /healthz   │ │
│           ▼                   ▼              └──────┬──────┘ │
│  ┌─────────────┐       ┌─────────────────────┐     │         │
│  │  vk-io      │       │  JSON file store    │◀────┘         │
│  │  API client │       │  ~/.claude/         │               │
│  │             │       │   channels/vk/      │               │
│  │             │       │     access.json     │               │
│  │             │       │     peers.json      │               │
│  └──────┬──────┘       └─────────────────────┘               │
└─────────┼─────────────────────────────────────────────────────┘
          │ HTTPS (groups.getLongPollServer + a_check)
          ▼
     VK.com Bots Long Poll
```

### 5.1 Why ElysiaJS

ElysiaJS holds a single port (**`127.0.0.1:6060`** by default, configurable via `PORT`) and serves the local admin + health surface only — there is no inbound HTTP route. Routes:

- `GET /healthz` — combined liveness + readiness probe (`{ ok, mcp }`) for users running the plugin under `tmux`, `systemd`, or similar.
- `POST /access/*`, `GET /state`, `GET /config` — surfaced to the slash commands so they don't have to edit JSON files directly. Edits go through Elysia handlers that validate and atomically write `access.json`; the `fs.watch` on that file picks up the change in-process.

Elysia is chosen over Hono / raw `Bun.serve` for end-to-end type inference on routes, native Bun runtime support, and clean validation via Elysia's `t` schemas.

### 5.2 Process model

Single Bun process. Claude Code spawns it under stdio for the MCP transport; the same process binds **`127.0.0.1:6060`** for the Elysia routes (admin + health). The listener is hard-bound to `127.0.0.1` — there's no inbound HTTP, so there's nothing to expose. If port 6060 conflicts, override via `PORT`.

Inbound VK events arrive via `vk-io`'s long-poll loop, which makes outbound HTTPS connections to `api.vk.com` (for `groups.getLongPollServer`) and the VK-supplied poll server (for `a_check`). No firewall rules or proxy required.

---

## 6. Stack

| Layer         | Choice                                       | Notes                                                                                                                                              |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | **Bun ≥ 1.2**                                | Same as Telegram plugin prerequisite. Claude Code v2.1.80+ required for channels; v2.1.81+ for permission relay.                                   |
| HTTP          | **ElysiaJS**                                 | Local admin + health API on `127.0.0.1:6060`. No inbound HTTP surface.                                                                             |
| VK client     | **vk-io**                                    | Active, supports community + user tokens. Owns both the REST API surface and the Bots Long Poll loop (`updates.start()`).                          |
| MCP           | **`@modelcontextprotocol/sdk`** (TypeScript) | Stdio transport. Channel capability `experimental.claude/channel`.                                                                                 |
| State         | **JSON files**                               | Atomic writes via tmp + rename; in-process locks; `fs.watch` for hot reload on hand-edits. No SQLite.                                              |
| Validation    | **Elysia `t` / TypeBox**                     | One schema source for HTTP, MCP tool input, and JSON file validation on load.                                                                      |
| Logging       | **Pino**                                     | Pretty in dev, JSON in prod; written to `~/.claude/channels/vk/log/`.                                                                              |
| Tests         | **Bun test**                                 | Colocated as `*.test.ts` next to source. MCP tool tests run against a mock vk-io; JSON store tests use a temp dir.                                 |
| Repo shape    | **Bun workspaces monorepo**                  | `server` (the process) + `packages/shared` (reserved for Eden Treaty client when an admin UI ships). Modules pattern inside `server/src/modules/`. |
| Lint / format | **prettier + husky + lint-staged**           | Reused verbatim from `depvault` — `@ianvs/prettier-plugin-sort-imports` + `prettier-plugin-tailwindcss`, root `prettier.config.js`.                |

---

## 7. Repository / plugin layout

The repo is a **Bun workspaces monorepo**. The repo root _is_ the plugin root — `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, and `commands/` sit at the top level so Claude Code's plugin loader finds them where it expects. The actual Bun process lives under `server/`, organized in a **modules pattern** (feature-cohesive folders, each owning its services, handlers, MCP tools, HTTP routes, types) — same shape as the user's `depvault`/`ogstack` backends. Tests are **colocated** as `*.test.ts` next to the file they cover. Lint/format is **identical to depvault**: root-level `prettier.config.js` with `@ianvs/prettier-plugin-sort-imports` + `prettier-plugin-tailwindcss`, `husky` + `lint-staged` in the root `package.json`.

`packages/shared` is reserved for the Eden Treaty client surface — re-exporting the Elysia app's types so any future `apps/admin-web` consumes routes end-to-end-typed (matching the depvault pattern). It does **not** hold TypeBox schemas: those live next to the modules that own them, and the admin UI never imports schemas directly — it imports the Eden client. Until `apps/admin-web` exists, `packages/shared` stays empty (or absent — add when needed).

The split inside `server/src/` is **infrastructure folders vs feature modules**:

- **Infrastructure** (`mcp/`, `state/`, `vk/`, `common/`) — primitives that every feature uses: MCP server lifecycle, JSON store, vk-io client, shared helpers. Infrastructure does not implement features and never imports from `modules/`.
- **Feature modules** (`modules/health/`, `modules/runtime/`, `modules/access/`, `modules/inbound/`, `modules/messaging/`, `modules/history/`, `modules/users/`, `modules/permission-relay/`) — each owns a slice of behavior end-to-end: services, schemas, MCP tool implementations, and (when applicable) an Elysia controller. Modules consume infrastructure.
- **`src/app.ts` is the only Elysia composition point.** It boots the MCP server, creates the Elysia app, mounts each module's controller plugin, and binds the listener. There is no separate `http/` infrastructure folder — `health` and `admin` are feature modules like the rest, just with no MCP surface.

```
claude-vk/
├── .claude-plugin/
│   └── plugin.json                       # plugin metadata
├── .mcp.json                             # ${pluginDir}/server/src/app.ts
├── README.md
├── ACCESS.md
├── package.json                          # workspaces: ["server"]; husky + lint-staged
├── tsconfig.json                         # root TS config (bundler, strict, ESNext) — same as depvault
├── prettier.config.js                    # reused verbatim from depvault
├── bun.lock
├── docs/
│   └── PRD-vk-plugin.md
├── skills/
│   └── vk/SKILL.md                       # how Claude should use the tools
├── commands/
│   ├── configure.md                      # /vk:configure
│   ├── access.md                         # /vk:access (now /skills/access/SKILL.md)
│   └── status.md                         # /vk:status
└── server/
    ├── package.json                      # name: "@claude-vk/server"
    ├── tsconfig.json                     # extends root; paths: { "@/*": ["./src/*"] }
    ├── bunfig.toml
    └── src/
        ├── app.ts                        # entrypoint: bootstrap → init stores → MCP stdio → startInbound → Elysia listen
        ├── env.ts                        # env var schema + dotenv overlay
        ├── config.ts                     # current() rebuilds from process.env each call
        │
        ├── common/                       # cross-cutting primitives
        │   ├── di/                       # tsyringe root container + bootstrap
        │   ├── logger/                   # pino instance
        │   ├── errors.ts                 # typed plugin errors
        │   ├── middleware/               # Elysia error handler
        │   ├── plugins/                  # Swagger
        │   ├── status.ts                 # in-process runtime status sink
        │   └── utils/                    # peer + tool-envelope helpers
        │
        ├── state/                        # JSON file store primitive — no domain knowledge
        │   ├── json-store.ts             # atomic write, TypeBox validation, optional fs.watch reload
        │   ├── json-store.test.ts
        │   └── paths.ts                  # ~/.claude/channels/vk/* path resolution
        │
        ├── vk/                           # vk-io client primitive — shared by every module that talks to VK
        │   ├── api.ts                    # VkApi interface (depend on this in tests)
        │   ├── api.types.ts              # *Params / *Response interfaces
        │   ├── client.ts                 # @singleton VkClient implements VkApi
        │   ├── mappers.ts                # coerce vk-io loose responses
        │   ├── rate-limiter.ts           # token bucket (20 req/s) + retry
        │   └── chunk-text.ts             # 4096-char chunker for send_message
        │
        ├── mcp/                          # MCP server lifecycle + capability declaration
        │   ├── server.ts                 # creates McpServer, wires stdio transport
        │   ├── capabilities.ts           # claude/channel + claude/channel/permission
        │   └── register-tools.ts         # resolves each module's *Tools and calls register()
        │
        ├── types/                        # cross-module schema building blocks
        │   └── common.schema.ts
        │
        └── modules/                      # feature modules (no index.ts barrels)
            ├── health/                   # /healthz (combined liveness + readiness)
            │   ├── health.controller.ts
            │   └── health.schema.ts
            │
            ├── runtime/                  # cross-cutting /config, /state
            │   ├── runtime.controller.ts
            │   ├── runtime.service.ts
            │   └── runtime.schema.ts
            │
            ├── access/                   # policy, pairing, two-layer gate, mention detection
            │   ├── access.controller.ts         # /access/* Elysia plugin
            │   ├── access.schema.ts             # TypeBox for access.json + route payloads
            │   ├── access.service.ts            # CRUD with typed-error throwing
            │   ├── access.store.ts              # JsonStore wrapper + fs.watch hot reload
            │   ├── access.gate.ts               # chat + sender + mention-policy checks
            │   ├── access.gate.test.ts
            │   ├── pairing.ts                   # 6-char codes, TTL, single-use
            │   ├── pairing.test.ts
            │   ├── community-resolver.ts        # auto-resolves community id/screen_name via groups.getById
            │   ├── mention.ts                   # @community / reply-to-bot detection
            │   └── mention.test.ts
            │
            ├── inbound/                  # long-poll loop, normalizer, notifier
            │   ├── long-poll.service.ts         # vk-io updates.start() + connect-backoff + message_new handler
            │   ├── inbound.service.ts           # pipeline: mention enrich → gate → ...
            │   ├── inbound.startup.ts           # wires notifier + permission-relay handler + starts long poll
            │   ├── inbound.types.ts             # InboundMessage shape
            │   ├── message-adapter.ts           # raw VK message → InboundMessage (transport-agnostic)
            │   ├── message-adapter.test.ts
            │   ├── notifier.ts                  # writes <channel> blocks
            │   ├── attachments.ts               # download inbound attachments to inbox/<peer_id>/<cmid>/
            │   └── attachments.test.ts
            │
            ├── messaging/                # outbound MCP tools (no HTTP surface)
            │   ├── messaging.tools.ts           # register fn called by mcp/register-tools.ts
            │   ├── messaging.service.ts         # send/edit/delete/react/mark-read
            │   ├── messaging.service.test.ts
            │   ├── messaging.schema.ts          # zod input shapes + result types
            │   ├── upload-attachment.ts         # photos/docs/voice upload
            │   ├── recent-sent.ts               # in-memory ring of (peer_id, cmid) for reply-to-bot
            │   └── random-id.ts
            │
            ├── history/                  # read-side MCP tools (the VK-vs-Telegram differentiator)
            │   ├── history.tools.ts
            │   ├── history.service.ts
            │   └── history.schema.ts
            │
            ├── users/                    # peers.json cache + get_user_info tool
            │   ├── users.schema.ts              # TypeBox for peers.json + zod for the tool
            │   ├── users.tools.ts
            │   └── users.cache.ts
            │
            ├── ping/                     # ping MCP tool (connectivity probe, no token needed)
            │   └── ping.tools.ts
            │
            └── permission-relay/         # claude/channel/permission handling
                ├── permission-relay.service.ts        # request → DM, verdict → MCP notification
                ├── permission-relay.service.test.ts
                ├── permission-relay.startup.ts        # wires MCP notification handler
                ├── permission-relay.schema.ts         # zod for the inbound MCP notification
                ├── verdict.ts                         # parse "yes XXXXX" / "no XXXXX"
                └── verdict.test.ts
```

### 7.1 Module conventions

- **Infrastructure vs module.** `mcp/`, `state/`, `vk/`, `common/` are infrastructure: they own a runtime primitive (MCP server lifecycle, JSON store, vk-io client) or a cross-cutting helper. They do not implement features and they never import from `modules/`. Modules import infrastructure freely.
- **One folder per feature, no further nesting.** A feature module is flat. We do not split a module into `services/` + `routes/` + `tools/` — at this scale that splits files by mechanical role rather than by concern, which is the kind of over-engineering we want to avoid. A module with eight files is fine; a module with eight files and three subfolders is not.
- **File naming inside a module:**
  - `{module}.controller.ts` — Elysia HTTP plugin exporting the module's routes. Example: `access.controller.ts` registers `/access/*`; `runtime.controller.ts` registers `/config` + `/state`; `health.controller.ts` registers `/healthz`.
  - `{module}.ws.ts` — Elysia WebSocket plugin, if the module needs one. (No module needs one in v1.)
  - `{module}.schema.ts` — TypeBox schemas owned by the module: persistent-file shapes (`access.schema.ts` defines `access.json`), HTTP payloads, and MCP tool input shapes for that module. One file per module — when both an MCP tool and an HTTP route in the same module need a shape, they import it from this file.
  - Everything else uses descriptive kebab-case names: `store.ts`, `gate.ts`, `pairing.ts`, `notifier.ts`, `send-message.ts`. No suffix gymnastics.
- **MCP tools are registered by their owning module.** Each module that exposes tools has a `{module}.tools.ts` whose default export is a `register(server)` function. `src/mcp/register-tools.ts` imports and calls each one on startup. The MCP server itself does not know what tools exist until those calls run.
- **HTTP routes are registered by their owning module.** `src/app.ts` mounts each module's `*.controller.ts` Elysia plugin during startup; there is no separate `http/` folder. The `runtime` module owns only the cross-cutting endpoints (`/config`, `/state`) — feature-specific endpoints (e.g. `/access/*`) live in the feature module itself.
- **`state/` holds _no_ schemas.** It's a generic store that takes any TypeBox schema as a validator. Schemas live with the module that owns the data.
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
    "start": "bun run --cwd server --silent start"
  }
}
```

There is no substitution for `~/.claude` in `.mcp.json`. The plugin resolves the state-dir path at runtime in `src/state/paths.ts` as `path.join(os.homedir(), '.claude', 'channels', 'vk')`.

---

## 8. MCP tools exposed to Claude

| Tool                       | Purpose                                                                                                                                                              | Notes                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_message`             | Send a message. Takes `peer_id` + `text`, optional `reply_to` (message conversation_id), `files` (absolute paths, ≤50MB each), `keyboard` (JSON for inline buttons). | Auto-chunks text past 4096 chars. Returns `conversation_message_id`. Works for both DM peers (`peer_id` = user id) and group chats (`peer_id ≥ 2_000_000_000`). |
| `edit_message`             | Edit a message previously sent by this identity. Takes `peer_id` + `conversation_message_id` + `text`.                                                               | Per VK rules, only the sender's own messages, only within 24h.                                                                                                  |
| `delete_message`           | Delete by `conversation_message_id`. `delete_for_all: bool`.                                                                                                         | 24h window for `delete_for_all`.                                                                                                                                |
| `react`                    | Add/replace a reaction. `reaction_id` from VK's enumerated set.                                                                                                      | Implemented via `messages.sendReaction`.                                                                                                                        |
| `mark_read`                | Mark a peer's messages as read up to a given message.                                                                                                                | Useful when Claude is reading history but not replying.                                                                                                         |
| `get_conversation_history` | Fetch the last N messages of a peer (default 20, max 200 per call). Returns normalized messages with author, text, attachments resolved to local paths if cached.    | This is the headline differentiator vs. Telegram.                                                                                                               |
| `search_messages`          | `messages.search` — full-text search across the identity's conversations. Returns top-K hits.                                                                        | Subject to VK API quotas.                                                                                                                                       |
| `get_user_info`            | Resolve a `user_id` to display name, screen name, photo URL, online status.                                                                                          | Backed by an in-memory + `peers.json` cache (TTL 1h).                                                                                                           |
| `upload_attachment`        | Upload a file to VK and return an attachment string (e.g. `photo123_456`) for use with `send_message`.                                                               | Separated out so Claude can preview/confirm before sending.                                                                                                     |

Tools are validated with TypeBox schemas shared between MCP and the Elysia admin API.

---

## 9. Inbound flow

VK delivers events via **Bots Long Poll only**. No public URL, no reverse proxy. The plugin makes outbound HTTPS connections to VK; the only firewall requirement is "allow outbound 443."

### 9.1 Long-poll loop

`LongPollService` wraps `vk-io`'s `updates.start()`:

- On boot, `vk-io` calls `groups.getById({})` to resolve the bound community ID, then `groups.getLongPollServer({ group_id })` to obtain `{ server, key, ts }`, then begins polling `{server}?act=a_check&key={key}&ts={ts}&wait=25`.
- The poll cursor (`ts`) and key are managed inside `vk-io` (in process memory). A "key expired" response triggers an automatic re-fetch of `getLongPollServer`.
- We subscribe to `message_new` and dispatch into `InboundService.handle`. No event-ID dedup ring — long poll's `ts` cursor never replays events.
- Connect failures (network down at boot, transient API errors) go through our backoff schedule: 1s → 2s → 4s → 8s → 16s → 30s, capped, retried until success or `stop()`.
- VK API error 5 (auth) is **fatal** — we log and give up. The user must fix the token.
- Missing `VK_TOKEN` is a no-op — long poll never starts, but the HTTP layer + `/healthz` stay alive so `/vk:configure` can still write a token.

**Prerequisite — enable Bots Long Poll in the community admin.** vk.com → Manage → API usage → Long Poll API → enable, set API version to ≥ 5.199, and check `message_new`. Without this, `groups.getLongPollServer` returns no server URL and the loop sits in backoff.

### 9.2 Normalization

`message-adapter.ts` produces an `InboundMessage` directly from `ctx.payload.message` (the raw snake-case VK message `vk-io` surfaces under each event context):

```ts
interface InboundMessage {
  peer_id: number; // chat identity (DM = user_id; group chat ≥ 2e9)
  from_id: number; // sender identity — ALWAYS gate on this
  conversation_message_id: number;
  text: string;
  attachments: Attachment[]; // each may have a local_path if downloaded
  reply_to?: number;
  is_group_chat: boolean; // peer_id >= 2_000_000_000
  mentioned_bot: boolean; // see §9.5 — enriched by MentionDetector after normalize
  is_reply_to_bot: boolean; // reply_to matches a cmid in RecentSentMessages
  received_at: string; // ISO
}
```

### 9.4 Two-layer access gate (DMs _and_ group chats)

The Anthropic channels reference is explicit: **gate on the sender's identity, not the chat or room identity**. In group chats `from_id` and `peer_id` differ, and gating on the room alone would let any member in an allowlisted chat inject prompts into the Claude session.

The plugin enforces this in `inbound/gate.ts`:

1. **Chat layer.** Is this `peer_id` allowed at all? (DM peer or group chat in `access.json → chats`.) If not → drop silently.
2. **Sender layer (group chats only).** Is `from_id` in the group chat's `senders` allowlist? DMs have one implicit sender (`peer_id == from_id`) so they skip this layer.
3. **Activation layer (group chats only).** Per the chat's `mention_policy`: forward all messages, only `@`-mentions, or only replies-to-bot. Default `mention_only` to keep the chat quiet.

Pseudocode:

```ts
const chat = access.chats[msg.peer_id];
if (!chat) return drop("chat-not-allowed");
if (chat.kind === "group_chat") {
  if (chat.senders.length > 0 && !chat.senders.includes(msg.from_id)) {
    return drop("sender-not-allowed");
  }
  if (chat.mention_policy === "mention_only" && !msg.mentioned_bot) {
    return drop("no-mention");
  }
}
await emit(msg);
```

### 9.5 Mention detection (group chats)

The `mention.ts` module marks `mentioned_bot: true` when **any** of:

- The message text contains `[club{COMMUNITY_ID}|...]` (VK's canonical mention format).
- The message text contains `@<community_screen_name>`.
- The message `reply_to` references a message the bot itself sent (looked up against the in-memory `RecentSentMessages` ring).
- The message carries a keyboard callback payload from a button the bot rendered. (Reserved — keyboard input isn't wired in v1.)

Community `id` + `screen_name` are resolved once at startup by `CommunityResolver.prefetch()`, which calls `groups.getById` on the community access token and caches the result. The values are available synchronously to the gate from that point on. If the call fails (no token, network), mention detection is disabled until the next restart — log-warned, not fatal.

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

> **Important — launch flag.** During the Claude Code channels research preview, `--channels` is restricted to plugins on Anthropic's curated allowlist. A user-developed VK plugin is _not_ on that allowlist, so the launch command for v1 is **`--dangerously-load-development-channels`**, not `--channels`. The bypass is per-entry and combining it with `--channels` does not extend the bypass. See §16 for the path to graduating onto the official allowlist.

1. **Create a community.** vk.com → Manage → Create community. Type: "Group" (works fine for both DMs and group-chat workflows).
2. **Enable bot capabilities.** Manage → Messages → enable "Community messages." Then "Bot capabilities" → on. To use the bot in multi-user chats, also enable "Allow adding to chats."
3. **Get an access token.** Manage → API usage → Access tokens → create with `messages`, `photos`, `docs`, `manage` scopes.
4. **Enable Bots Long Poll.** Manage → API usage → Long Poll API → enable, set API version to ≥ `5.199`, and check the `message_new` event. Save `VK_TOKEN` in `~/.claude/channels/vk/.env`:
   ```
   VK_TOKEN=...
   ```
5. **Install the plugin** (from your marketplace — see §16 on publishing):
   ```
   /plugin marketplace add github:you/your-marketplace
   /plugin install vk@your-marketplace
   /reload-plugins
   ```
6. **Relaunch with the development channels flag.** Exit your session and start a new one:
   ```
   claude --dangerously-load-development-channels plugin:vk@your-marketplace
   ```
   Claude Code prompts for confirmation on first launch. The plugin will not connect without this flag.
7. **Pair (DM use).** DM the community on VK; the bot replies with a 6-character pairing code. In Claude:
   ```
   /vk:access pair <code>
   ```
   This adds the DM peer to `access.json → chats` as `{ kind: "dm" }`.
8. **Add a group chat (optional).** Add the bot to a VK group chat, then opt it in by `peer_id` from Claude:
   ```
   /vk:access group add <peer_id>
   ```
   Adds the chat to `access.json → chats` with `senders=[]` (anyone in the chat may write) and `mention_policy=mention_only`. Lock it down by passing `--allow id1,id2` and/or `--mention-policy {mention_only|all|reply_only}`. There is no group pairing flow.
9. **Lock DMs down.**

   ```
   /vk:access policy allowlist
   ```

   Group chats are already opt-in by `peer_id`, so they don't need a separate switch.

The community ID and screen name are auto-resolved at startup from `groups.getById` — no configuration step required.

---

## 11. Access control

A chat is either allowed or not. Group chats additionally carry a per-chat sender allowlist; DMs do not (a DM has one implicit sender). This is a direct consequence of the channels reference's "gate on sender, not chat" guidance — applied to a platform that has _both_.

### 11.1 Policies

DMs have a `dm_policy` setting; group chats have none — they're always opt-in by `peer_id` via `/vk:access group add`. The `disabled` value is a global kill switch and silences both DMs and group chats.

| Policy      | Scope        | Behavior                                                                                                  |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `pairing`   | DMs          | Unknown DM peers get a pairing-code reply. **Default.** Use to onboard new people.                        |
| `allowlist` | DMs          | Only paired DM peers are forwarded. Anything else is dropped silently (or replied to once per 24h).       |
| `disabled`  | DMs + groups | Global kill switch — every inbound message is dropped silently (DMs and group chats, allowlisted or not). |

Group chats are off until the operator runs `/vk:access group add <peer_id>` — there is no group pairing flow and no group policy switch.

### 11.2 `access.json` schema

Stored at `~/.claude/channels/vk/access.json`, mode `0600`. Hand-editable; server hot-reloads on change (with TypeBox validation — bad edits are rejected with a `<channel>` warning, and the previous version stays live).

```json
{
  "version": 1,
  "dm_policy": "allowlist",
  "chats": {
    "123456": {
      "kind": "dm",
      "title": "Ivan Petrov",
      "added_at": "2026-05-14T10:21:00Z",
      "added_by": "pairing"
    },
    "2000000042": {
      "kind": "group_chat",
      "title": "Team Standup",
      "senders": [123456, 234567, 345678],
      "mention_policy": "mention_only",
      "added_at": "2026-05-14T11:02:00Z",
      "added_by": "manual"
    }
  },
  "pending_pairs": {
    "x7k4mq": {
      "peer_id": 999111,
      "from_id": 999111,
      "expires_at": "2026-05-14T11:30:00Z"
    }
  }
}
```

Notes:

- Keys under `chats` are stringified `peer_id`s. DM peers are user IDs (`< 2_000_000_000`); group chat peers are `≥ 2_000_000_000` (VK's convention).
- `senders` (group chats only) is an array of VK user IDs. Empty means "any member of the chat may write." DM entries omit the field — a DM only ever has one sender.
- `mention_policy` (group chats): `"mention_only"` (default), `"all"`, or `"reply_only"`. Controls activation, not access — a non-mention from an allowed sender is gated by activation policy and dropped silently when off.
- `pending_pairs` is the live pairing-code table. TTL 10 min, single-use. Codes are 6 chars from a 32-char alphabet excluding `0/O/1/I/l`.

### 11.3 Group-chat-specific behavior

- **Bot joins:** Group chats stay silent on join — VK delivers the messages, but the gate drops them as `chat-not-allowed`. The operator opts each chat in by `peer_id` with `/vk:access group add <peer_id>`. There is no group-chat pairing flow.
- **Privacy mode:** The bot needs "Read all messages" permission turned **off** in the community settings unless explicitly desired. When off, VK only delivers messages where the bot is mentioned or replied-to — a nice belt-and-braces alongside the mention-policy gate.
- **Adding senders:** `/vk:access add-sender <peer_id> <user_id_or_screen_name>` resolves screen names via `users.get` and writes the ID.
- **Removing the bot from a chat:** Generates a `chat_kick_user` event; we mark the chat `inactive` (kept for audit) and stop forwarding.

---

## 12. Slash commands

| Command                                                               | Action                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/vk:configure <token>`                                               | Writes `VK_TOKEN` into `~/.claude/channels/vk/.env` and prints the webhook URL + secret to paste into VK.     |
| `/vk:access pair <code>`                                              | DM only. Consumes a pending pairing code; adds the DM peer to `chats`.                                        |
| `/vk:access group add <peer_id> [--allow ids] [--mention-policy …]`   | Opt a group chat in. Optional `--allow` seeds the sender list; `--mention-policy` defaults to `mention_only`. |
| `/vk:access group remove <peer_id>`                                   | Drop a group chat. Same effect as `remove-chat`.                                                              |
| `/vk:access policy {pairing\|allowlist\|disabled}`                    | Set the DM policy. Group chats have no policy (always opt-in by `peer_id`).                                   |
| `/vk:access list [--chats\|--senders <peer_id>]`                      | Lists allowlisted chats with resolved titles, or senders for a specific chat.                                 |
| `/vk:access add-sender <peer_id> <user_id_or_@screen_name>`           | Adds a sender to a **group chat**'s allowlist. Resolves screen names. DMs reject (single implicit sender).    |
| `/vk:access remove-sender <peer_id> <user_id>`                        | Removes a sender from a group chat. DMs reject.                                                               |
| `/vk:access remove-chat <peer_id>`                                    | Drops a chat entirely.                                                                                        |
| `/vk:access mention-policy <peer_id> {mention_only\|all\|reply_only}` | Group chats only — controls activation, not access.                                                           |
| `/vk:status`                                                          | Prints: transport, connection health, community handle, policies, chat count, sender count, last error.       |

All commands hit `http://127.0.0.1:6060/{access,config,state}`, so they work even from within skills. The local management API performs validation, atomic write to the relevant JSON file, and signals the inbound router to reload its cached gate.

---

## 13. State, persistence, secrets

Persistent state is **two JSON files**. Both are written atomically (write-to-tmp + rename), serialized through an in-process write chain, and validated against TypeBox schemas on load and update. A malformed write is rejected and the previous in-memory version stays live.

- **`~/.claude/channels/vk/.env`** (`0600`) — `VK_TOKEN`, optional `PORT` / `LOG_LEVEL` / `NODE_ENV`. Read once at startup; shell env overrides.
- **`~/.claude/channels/vk/access.json`** (`0600`) — policies, chats, senders, mention policies, pending pair codes (schema in §11.2). Hot-reloaded via `fs.watch`.
- **`~/.claude/channels/vk/peers.json`** (`0644`) — resolved VK user/group metadata cache, TTL 1h. Safe to delete; rebuilds on demand.
- **`~/.claude/channels/vk/inbox/`** (dir) — downloaded attachments, grouped by `<peer_id>/<cmid>/`.
- **`~/.claude/channels/vk/log/`** (dir) — Pino logs, rotated daily, 7-day retention.

The state directory path is fixed (`~/.claude/channels/vk`); there is no `VK_STATE_DIR` override.

**In-memory state.** Two transient slices live in process memory only — `RecentSentMessages` (cap-200 ring of outbound `(peer_id, cmid)` for reply-to-bot detection) and `vk-io`'s long-poll cursor (`ts` + key). Both reset on restart. A restart loses any unread `ts` window; long poll re-fetches a fresh server on `getLongPollServer` and resumes from VK's current position, so brief gaps are possible but rare.

**Why JSON over SQLite.** Smaller dependency surface, no migrations, transparent to users editing by hand or grep-ing for a value, trivially version-controllable for backup. The cost is read performance on the peers cache, which we mitigate with an in-process cache; at the volumes a single-user VK community sees, this is comfortably below any threshold where SQLite would pay back its complexity.

**Concurrency.** A single Bun process owns all writes. `JsonStore.update()` serializes mutations through a promise chain so concurrent updates can't interleave.

---

## 14. Error handling & rate limits

- Group token: 20 req/sec — enforce via a token-bucket limiter in `vk/client.ts`. Burst 20, refill 20/s. Note: long-poll `a_check` requests do **not** go through this limiter — they hit a dedicated poll server, not `api.vk.com`, and aren't subject to the 20 req/sec quota.
- VK returns `error_code: 6` (Too many requests) — back off 250ms × attempt, max 5 retries.
- `error_code: 9` (Flood control) on `messages.send` to new peers — return the error to Claude rather than retrying; pairing UX should make this rare.
- VK returns `error_code: 5` (auth) during long-poll start — fatal; we log and abort the loop. The user fixes the token, then `/vk:configure` writes a new one and a restart picks it up.
- Long-poll connect failures (network, transient API errors) retry with backoff: 1s → 2s → 4s → 8s → 16s → 30s, capped, until success or `stop()`. Key-expired during a running poll is handled transparently by `vk-io`.
- Tool calls that fail return structured errors `{ ok: false, code, message }` so Claude can decide whether to retry or ask the user.

---

## 15. Permission relay

VK is a particularly good fit for `claude/channel/permission`: you're already messaging the bot from your phone, so receiving Claude's tool-approval prompts in the same chat lets you greenlight (or deny) work without returning to the terminal. The capability is **always advertised** — the access gate already authenticates senders, so the precondition from the channels reference is satisfied for every install.

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

- The MCP server declares `experimental.claude/channel/permission: {}` alongside `claude/channel: {}` unconditionally.
- The channels reference is explicit: **only declare this capability when the channel authenticates the sender** — because anyone who can reply through the channel can approve tool use. Our gate (§9.4) does, so this is satisfied. We additionally refuse verdicts from group chats (DMs only — too easy to social-engineer a group) and require the verdict-sender to match the originating user of the request.
- If `from_id` does not match the originating-user of the request, the verdict is dropped silently and a `<channel>` warning is emitted to Claude.
- Project-trust and MCP-server-consent dialogs are _not_ relayed (per the channels reference). Those continue to require terminal interaction.

---

## 16. Privacy & security

- Token never leaves the local machine. Logged values are redacted by Pino.
- `.env` and `access.json` are mode `0600`. `peers.json` is `0644` (no secrets).
- No inbound HTTP — long poll makes outbound HTTPS only, so there is no public attack surface to harden.
- HTTP listener (port **6060**) is **hard-bound to `127.0.0.1`** for admin + health only. No env override.
- Pairing codes are 6 chars from a 32-char alphabet (excludes `0/O/1/I/l`), single-use, TTL 10 min.
- Attachments downloaded only from VK CDN domains (allowlisted by host).
- Permission relay (§15) refuses verdicts from group chats and from users who didn't originate the request.
- `/vk:status` surfaces whether the token has unnecessary scopes (e.g. `wall`) and warns.

---

## 17. Differences from the Telegram plugin

| Concern               | Telegram                                     | VK                                                                                            |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Message history       | Not available — bot only sees live messages. | **Available** via `get_conversation_history`.                                                 |
| Search                | Not available.                               | **Available** via `search_messages`.                                                          |
| Reactions             | Fixed whitelist.                             | Enumerated set, fetched from VK at startup; passed to Claude as part of the tool description. |
| Transport             | Bot API (long polling).                      | **Bots Long Poll only** (outbound HTTPS, no public URL).                                      |
| Setup                 | BotFather + token.                           | Community + token + enable Long Poll in admin panel.                                          |
| HTTP layer            | None needed.                                 | **ElysiaJS** on `127.0.0.1:6060` for admin + health (no inbound HTTP).                        |
| Peer IDs              | `chat_id` is a single int.                   | `peer_id` splits user (<2e9) vs group chat (≥2e9).                                            |
| Group chats           | Deferred to `ACCESS.md`.                     | **Supported in v1** with two-layer access and mention-detection.                              |
| State store           | `.env` + access.json.                        | `.env` + `access.json` + `peers.json` cache. No SQLite.                                       |
| Permission relay      | Available.                                   | **Always on** — recommended for VK-from-phone workflow.                                       |
| Launch flag (preview) | `--channels` (allowlisted).                  | `--dangerously-load-development-channels` until accepted onto the allowlist.                  |

### Path to the official allowlist

To eventually launch with the unprefixed `--channels` flag, the plugin needs to be added to Anthropic's curated allowlist. The route documented in the channels reference is to submit the plugin to the official marketplace for security review. On Team/Enterprise tenancies, an admin can alternatively add `vk@your-marketplace` to the org's `allowedChannelPlugins` list, which replaces the default Anthropic allowlist for that org.

---

## 18. Milestones

- ✅ **M0 — Skeleton.** `.claude-plugin/plugin.json`, `.mcp.json`, Bun project, Elysia hello-world on port 6060, MCP server declaring `experimental.claude/channel: {}` and exposing a single `ping` tool. End-to-end: `claude --dangerously-load-development-channels plugin:vk@your-marketplace` lights up and `<channel>` events flow.
- ✅ **M1 — Outbound.** `send_message`, `edit_message`, `delete_message`. Manual peer ID. Token bucket limiter. JSON store skeleton.
- ✅ **M2 — Inbound + DM.** Long-poll loop, normalizer, notifier writing `<channel>` blocks, attachment download. DM-only access gate.
- ✅ **M3 — Access + JSON store.** Pairing flow, two-layer allowlist, `/vk:access` commands, hot reload on file change, atomic writes.
- ✅ **M4 — Group chats.** `is_group_chat` detection, mention-detection, per-chat sender allowlist, `mention_policy`, group-chat pairing UX.
- ✅ **M5 — Rich tools.** `react`, `mark_read`, `get_conversation_history`, `search_messages`, `get_user_info`, `upload_attachment`.
- ✅ **M6 — Transport iteration.** Briefly swapped to Callback API for public-IP deploys, then reverted to Bots Long Poll as the sole transport — no public URL needed, simpler for the local-first install. `webhook.*`, `event-dedup`, and `inbound.controller` deleted.
- ✅ **M7 — Permission relay.** `claude/channel/permission` capability, request handler, verdict regex in inbound, originating-user check, DM-only constraint. Always on.
- 🚧 **M8 — Polish.** `README.md`, `ACCESS.md`, `/vk:status`, error UX, log rotation, Bun test suite for tools + access gate, allowlist-submission packaging.
- **v1 release.** All above.

---

## 19. Open questions

1. **User tokens.** Should v2 add OAuth-based user-token mode? It enables much more (friends, dialogs across all peers including DMs that aren't with the community), but the OAuth flow is awkward for a local CLI plugin, and VK is increasingly hostile to non-community user-token automation. _Recommendation: defer to v2, document why._
2. **Allowlist submission.** When do we submit to the official Anthropic marketplace? v1 ships behind `--dangerously-load-development-channels`. Submitting earlier triggers security review and constrains design; later defers the "single-flag" UX win. _Recommendation: post-v1, after at least one external user has shaken out the access gate._
3. **Keyboards.** VK has inline keyboards (richer than Telegram's). Worth exposing as a first-class param to `send_message`, or leave as a raw JSON pass-through? _Recommendation: raw pass-through in v1, typed schema in v2._
4. **Voice messages.** VK voice messages decode to OGG/Opus. Transcribe locally via `whisper-cli`, or pass the raw file? _Recommendation: pass raw, document the optional whisper hook in `SKILL.md`._
5. **Peers cache growth.** `peers.json` could grow unbounded over months in a large community. _Recommendation: enforce 10k-entry LRU eviction; warn at 8k. Shipped._

---

## 20. Out of scope (explicit)

- Hosted/SaaS deployment.
- Anything that requires VK's "official app" permissions (call logs, profile edits, money transfers).
- A web admin UI in v1. Slash commands are the admin surface.
- Translation/i18n of the bot's own auto-replies. v1 ships English-only; non-English copy can be added when there's demand.
- VK Callback API / webhooks. The plugin is long-poll-only — there is no inbound HTTP route.
- Multiple plugin instances on one machine. The state directory is fixed at `~/.claude/channels/vk`.

---
