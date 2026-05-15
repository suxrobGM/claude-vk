# CLAUDE.md

## What this is

`claude-vk` is a Claude Code **channel plugin** bridging VK.com (DMs + group chats) into a session. Single Bun process: MCP stdio server + ElysiaJS on `127.0.0.1:6060` (admin + health only — no inbound HTTP). MCP capabilities: `experimental.claude/channel` + `claude/channel/permission` (always on).

Inbound transport is **VK Bots Long Poll only** — no public URL, no reverse proxy. `vk-io`'s `updates.start()` owns the poll cursor (`ts`), retries, and key-expired refresh; we wrap it with a connect-backoff loop and a `message_new` handler.

PRD: [docs/prd.md](docs/prd.md) — source of truth. M0–M7 shipped; M8 polish in progress.

## Commands

- `bun run dev` / `bun run start` — boot (watch / no-watch)
- `bun run test` — `bun test` across workspaces; `*.test.ts` colocated
- `bun run typecheck` — `tsc --noEmit`
- Single file: `bun test server/src/vk/rate-limiter.test.ts`
- Single name: `bun test -t "<pattern>"`

Pre-commit: `lint-staged` → `prettier --write` via husky. Don't bypass.

## Architecture

**Composition.** [app.ts](server/src/app.ts) is the only composition point and runs phases in order: `bootstrapContainer()` → init persistent stores (`AccessStore`, `UsersCache`) → `startMcpServer()` (which calls `registerAllTools`) → `startInbound(mcp)` (channel notifier, permission-relay handler, community resolver prefetch) → mount each module's `*.controller.ts` on Elysia → `listen`. Stores load **before** MCP connects so tool handlers can't hit an uninitialized cache.

**Infrastructure vs modules.** `mcp/`, `state/`, `vk/`, `common/` are infrastructure — never import from `modules/`. Feature modules under `modules/` are flat; one folder per concern, no further nesting, no module-level `index.ts` barrels. File suffixes: `*.controller.ts` (Elysia), `*.tools.ts` (MCP), `*.service.ts`, `*.schema.ts` (zod for MCP inputs + TypeBox for persistent/HTTP shapes).

**Implemented modules:** `health`, `ping`, `messaging`, `access`, `admin`, `inbound`, `history`, `users`, `permission-relay`.

**MCP tools.** Each module has `@injectable() *Tools` with `register(server)`; [mcp/register-tools.ts](server/src/mcp/register-tools.ts) resolves and calls each. To add: zod `*InputShape` in `*.schema.ts`, service method returning `{ ok: true, ... } | ToolFailure` wrapped in `runWithEnvelope`, `register(server)` call wrapping with `toCallResult`, container line. Both helpers live in [common/utils/tool-envelope.ts](server/src/common/utils/tool-envelope.ts).

Tool handlers **never throw to MCP** — `VkApiError`/`PluginError` collapse to `{ ok: false, code, message }`; anything else becomes `internal_error`. Throwing closes the connection.

**VK surface (split for clarity).**

- [vk/api.ts](server/src/vk/api.ts) — `VkApi` interface (depend on this in tests, not `VkClient`).
- [vk/api.types.ts](server/src/vk/api.types.ts) — every `*Params` / `*Response` interface. No inline shapes.
- [vk/mappers.ts](server/src/vk/mappers.ts) — coerce vk-io's loose responses.
- [vk/client.ts](server/src/vk/client.ts) — `@singleton() VkClient implements VkApi`. Lazy `VK` ctor so `/healthz` works without `VK_TOKEN`. Every method routes through `this.run(fn)` → [`RateLimiter.withRetry`](server/src/vk/rate-limiter.ts) (20 req/s token bucket; error 6 retries 5× w/ 250ms × attempt; error 9 fatal). Limiter uses a sleep-loop, not timers — keep it that way so `bun test` exits.

**Config.** [env.ts](server/src/env.ts) merges `~/.claude/channels/vk/.env` under `process.env`; [config.ts](server/src/config.ts) exposes `current()`. `current()` validates once on first call (writes defaults back to `process.env`) and rebuilds a fresh snapshot from `process.env` on every subsequent call — call at use-time, never capture.

The user only configures **`VK_TOKEN`** and optionally **`PORT`** / **`LOG_LEVEL`**. The HTTP listener is hard-bound to `127.0.0.1` — there is no inbound HTTP surface, so no public-exposure knob. The bound community's `id` and `screen_name` are auto-resolved at startup via `groups.getById` and cached in [`CommunityResolver`](server/src/modules/access/community-resolver.ts) — no env override.

**State (JSON, never SQLite).** [state/json-store.ts](server/src/state/json-store.ts) is the generic store: atomic tmp+rename writes, in-memory cache, serialized writes, TypeBox validation on load + update. Bad writes are rejected; previous version stays live. Schemas live with the module that owns the file.

Two persistent files only — both under `~/.claude/channels/vk/` (path fixed at install time):

- `access.json` — policies, chats, senders, mention policies, pending pair codes. Watched via `fs.watch`, hot-reloaded.
- `peers.json` — VK user/group metadata cache (TTL 1h, LRU 10k).

No `state.json`. The long-poll cursor is owned by `vk-io` (in-memory; a restart starts from VK's current `ts` and may briefly miss in-flight events, which is acceptable), and the recent-sent-cmid ring (`RecentSentMessages`) lives in process memory too.

**Access + mention.** Three-layer gate in [access/access.gate.ts](server/src/modules/access/access.gate.ts): chat allowlist → per-chat senders → mention-policy (group chats only). Gate on **`from_id`, not `peer_id`** (PRD §9.4). Mention signals in [access/mention.ts](server/src/modules/access/mention.ts) — `name_mention` (`[club{ID}|...]` or `@screen_name`), `reply_to_bot` (cmid in `RecentSentMessages`), `keyboard_payload` (reserved). `isPairCommand` requires explicit `@<community> pair` — group chats never auto-emit codes.

Policies: DM and group chat each take `pairing` (default) or `allowlist`. No `open` policy.

**Inbound.** [inbound/long-poll.service.ts](server/src/modules/inbound/long-poll.service.ts) wraps `vk-io`'s `updates.start()` — auto-resolves the bound group ID, owns the poll cursor + key-expired refresh. We layer on a connect-backoff loop (1s→30s, code 5 fatal) and a `message_new` handler that converts via [`vkMessageToInbound`](server/src/modules/inbound/message-adapter.ts) and dispatches into [`InboundService.handle`](server/src/modules/inbound/inbound.service.ts). Pipeline: `mention enrich → gate → (drop | pair | permission verdict | download + notify)`. Never throws — every failure is logged and the poll loop continues. Notifier emits `<channel source="vk" ...>` with `mentioned` + `reply_to_bot` meta. Group chats default to `mention_only`.

**Peer IDs.** `peer_id ≥ 2_000_000_000` = group chat. Use `isGroupChat()` from [common/utils/peer.ts](server/src/common/utils/peer.ts).

## Conventions

- Path alias `@/*` → `server/src/*`.
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
