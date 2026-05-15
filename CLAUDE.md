# CLAUDE.md

## What this is

`claude-vk` is a Claude Code **channel plugin** bridging VK.com (DMs + group chats) into a session. Single Bun process: MCP stdio server + ElysiaJS on `127.0.0.1:6060`. MCP capabilities: `experimental.claude/channel` + `claude/channel/permission` (always on).

Inbound transport is **VK Callback API only** — the user fronts `127.0.0.1:6060/webhook/vk` with their own reverse proxy (Caddy / Cloudflare Tunnel / ngrok).

PRD: [docs/prd.md](docs/prd.md) — source of truth. M0–M7 shipped; M8 polish in progress.

## Commands

- `bun run dev` / `bun run start` — boot (watch / no-watch)
- `bun run test` — `bun test` across workspaces; `*.test.ts` colocated
- `bun run typecheck` — `tsc --noEmit`
- Single file: `bun test apps/plugin/src/vk/rate-limiter.test.ts`
- Single name: `bun test -t "<pattern>"`

Pre-commit: `lint-staged` → `prettier --write` via husky. Don't bypass.

## Architecture

**Composition.** [app.ts](apps/plugin/src/app.ts) is the only composition point and runs phases in order: `bootstrapContainer()` → init persistent stores (`AccessStore`, `UsersCache`) → `startMcpServer()` (which calls `registerAllTools`) → `startInbound(mcp)` (channel notifier, permission-relay handler, community resolver prefetch) → mount each module's `*.controller.ts` on Elysia → `listen`. Stores load **before** MCP connects so tool handlers can't hit an uninitialized cache.

**Infrastructure vs modules.** `mcp/`, `state/`, `vk/`, `common/` are infrastructure — never import from `modules/`. Feature modules under `modules/` are flat; one folder per concern, no further nesting, no module-level `index.ts` barrels. File suffixes: `*.controller.ts` (Elysia), `*.tools.ts` (MCP), `*.service.ts`, `*.schema.ts` (zod for MCP inputs + TypeBox for persistent/HTTP shapes).

**Implemented modules:** `health`, `ping`, `messaging`, `access`, `admin`, `inbound`, `history`, `users`, `permission-relay`.

**MCP tools.** Each module has `@injectable() *Tools` with `register(server)`; [mcp/register-tools.ts](apps/plugin/src/mcp/register-tools.ts) resolves and calls each. To add: zod `*InputShape` in `*.schema.ts`, service method returning `{ ok: true, ... } | ToolFailure` wrapped in `runWithEnvelope`, `register(server)` call wrapping with `toCallResult`, container line. Both helpers live in [common/utils/tool-envelope.ts](apps/plugin/src/common/utils/tool-envelope.ts).

Tool handlers **never throw to MCP** — `VkApiError`/`PluginError` collapse to `{ ok: false, code, message }`; anything else becomes `internal_error`. Throwing closes the connection.

**VK surface (split for clarity).**

- [vk/api.ts](apps/plugin/src/vk/api.ts) — `VkApi` interface (depend on this in tests, not `VkClient`).
- [vk/api.types.ts](apps/plugin/src/vk/api.types.ts) — every `*Params` / `*Response` interface. No inline shapes.
- [vk/mappers.ts](apps/plugin/src/vk/mappers.ts) — coerce vk-io's loose responses.
- [vk/client.ts](apps/plugin/src/vk/client.ts) — `@singleton() VkClient implements VkApi`. Lazy `VK` ctor so `/healthz` works without `VK_TOKEN`. Every method routes through `this.run(fn)` → [`RateLimiter.withRetry`](apps/plugin/src/vk/rate-limiter.ts) (20 req/s token bucket; error 6 retries 5× w/ 250ms × attempt; error 9 fatal). Limiter uses a sleep-loop, not timers — keep it that way so `bun test` exits.

**Config.** [env.ts](apps/plugin/src/env.ts) merges `~/.claude/channels/vk/.env` under `process.env`; [config.ts](apps/plugin/src/config.ts) exposes `current()`. `current()` validates once on first call (writes defaults back to `process.env`) and rebuilds a fresh snapshot from `process.env` on every subsequent call — call at use-time, never capture.

The user only configures **`VK_TOKEN`**, optional **`VK_WEBHOOK_SECRET`** / **`VK_WEBHOOK_CONFIRMATION`**, and optional **`VK_PORT`** / **`VK_HTTP_BIND`** / **`LOG_LEVEL`**. The bound community's `id` and `screen_name` are auto-resolved at startup via `groups.getById` and cached in [`CommunityResolver`](apps/plugin/src/modules/access/community-resolver.ts) — no env override.

**State (JSON, never SQLite).** [state/json-store.ts](apps/plugin/src/state/json-store.ts) is the generic store: atomic tmp+rename writes, in-memory cache, serialized writes, TypeBox validation on load + update. Bad writes are rejected; previous version stays live. Schemas live with the module that owns the file.

Two persistent files only — both under `~/.claude/channels/vk/` (path fixed at install time):

- `access.json` — policies, chats, senders, mention policies, pending pair codes. Watched via `fs.watch`, hot-reloaded.
- `peers.json` — VK user/group metadata cache (TTL 1h, LRU 10k).

No `state.json` — the long-poll cursor (gone), webhook event-ID dedup, and recent-sent-cmid ring all live in process memory (`EventIdDedup`, `RecentSentMessages`). A restart loses the dedup window, which is acceptable since VK's retry window is short and inbound is idempotent enough.

**Access + mention.** Three-layer gate in [access/access.gate.ts](apps/plugin/src/modules/access/access.gate.ts): chat allowlist → per-chat senders → mention-policy (group chats only). Gate on **`from_id`, not `peer_id`** (PRD §9.4). Mention signals in [access/mention.ts](apps/plugin/src/modules/access/mention.ts) — `name_mention` (`[club{ID}|...]` or `@screen_name`), `reply_to_bot` (cmid in `RecentSentMessages`), `keyboard_payload` (reserved). `isPairCommand` requires explicit `@<community> pair` — group chats never auto-emit codes.

Policies: DM and group chat each take `pairing` (default) or `allowlist`. No `open` policy.

**Inbound.** [inbound/webhook.service.ts](apps/plugin/src/modules/inbound/webhook.service.ts) receives `POST /webhook/vk`, dedups by `event_id` via [`EventIdDedup`](apps/plugin/src/modules/inbound/event-dedup.ts), converts via [`webhookMessageNewToInbound`](apps/plugin/src/modules/inbound/webhook-adapter.ts), and dispatches into [`InboundService.handle`](apps/plugin/src/modules/inbound/inbound.service.ts). The webhook returns `200 "ok"` immediately (PRD §9.2 — VK marks the endpoint unhealthy on any non-2xx); processing is fire-and-forget. Pipeline: `mention enrich → gate → (drop | pair | permission verdict | download + notify)`. Never throws — every failure is logged and the controller's 200 is preserved. Notifier emits `<channel source="vk" ...>` with `mentioned` + `reply_to_bot` meta. Group chats default to `mention_only`.

**Peer IDs.** `peer_id ≥ 2_000_000_000` = group chat. Use `isGroupChat()` from [common/utils/peer.ts](apps/plugin/src/common/utils/peer.ts).

## Conventions

- Path alias `@/*` → `apps/plugin/src/*`.
- Strict TS + `noUncheckedIndexedAccess`. Assert `!` only when bound is obvious one line up.
- Object shapes: `export interface`, not `export type X = {...}`. Reserve `type` for unions/intersections.
- `tsyringe` services use `@injectable()` / `@singleton()`. `bootstrapContainer` is for non-class value registrations only.
- Logger: `import { logger } from "@/common/logger"` — never via DI.
- Errors: extend `PluginError` with a stable `code`. `VkApiError` derives `vk_api_<n>` from VK's numeric code.
- `MessagingService.send` feeds every outbound `cmid` into `RecentSentMessages.push` so reply-to-bot can resolve it.
- Import from concrete files (`./mention`, `@/modules/access/access.controller`) — never module barrels.
- No emojis in code or commits unless asked.

## Platform notes

Developed on Windows (PowerShell). `chmod` failures are no-oped on Windows in `json-store.ts` + `env.ts` — don't hard-fail there.
