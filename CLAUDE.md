# CLAUDE.md

## What this is

`claude-vk` is a Claude Code **channel plugin** bridging VK.com (DMs + group chats) into a session. Single Bun process: MCP stdio server + ElysiaJS on `127.0.0.1:6060` (admin + health only). Inbound is **VK Bots Long Poll only** — no public URL.

PRD: [docs/prd.md](docs/prd.md) — source of truth.

## Commands

- `bun run dev` / `bun run start` — boot (watch / no-watch)
- `bun run test` — `bun test`; `*.test.ts` colocated
- `bun run typecheck` — `tsc --noEmit`
- Single test: `bun test <path>` or `bun test -t "<pattern>"`

Pre-commit `lint-staged` + `prettier` via husky — don't bypass.

## Architecture

**Composition.** [app.ts](server/src/app.ts) is the only composition point: `bootstrapContainer()` → init stores (`AccessStore`, `UsersCache`) → `startMcpServer()` → `startInbound(mcp)` → mount controllers → `listen`. Stores load **before** MCP connects.

**Layout.** `mcp/`, `state/`, `vk/`, `common/` are infrastructure — never import from `modules/`. Feature modules are flat (no barrels); only permitted nesting is a `schemas/` subfolder. Suffixes: `*.controller.ts` (Elysia), `*.tools.ts` (MCP), `*.service.ts`, `*.schema.ts` (zod for MCP, TypeBox for persistent/HTTP).

**MCP tools.** Each module has `@injectable() *Tools` with `register(server)`; [mcp/register-tools.ts](server/src/mcp/register-tools.ts) wires them. Service returns `{ ok: true, ... } | ToolFailure` via `runWithEnvelope`; handler wraps with `toCallResult` ([common/utils/tool-envelope.ts](server/src/common/utils/tool-envelope.ts)). Tool handlers **never throw to MCP** — throwing closes the connection. `VkApiError`/`PluginError` collapse to `{ ok: false, code, message }`; anything else becomes `internal_error`.

**VK surface.** Depend on `VkApi` interface ([vk/api.ts](server/src/vk/api.ts)), not `VkClient`. Param/response shapes live in [vk/api.types.ts](server/src/vk/api.types.ts). [vk/client.ts](server/src/vk/client.ts) routes every call through [`RateLimiter.withRetry`](server/src/vk/rate-limiter.ts) (20 req/s; error 6 retries 5×; error 9 fatal). Limiter uses sleep-loops, not timers — keep it that way so `bun test` exits.

**Config.** [config.ts](server/src/config.ts) `current()` validates once, then rebuilds a snapshot from `process.env` per call — call at use-time, never capture. User configures **`VK_TOKEN`** and optionally `PORT` / `LOG_LEVEL`. HTTP is hard-bound to `127.0.0.1`. Community `id` / `screen_name` auto-resolved at startup via [`CommunityResolver`](server/src/modules/access/community-resolver.ts).

**State (JSON, never SQLite).** [state/json-store.ts](server/src/state/json-store.ts) — atomic tmp+rename, in-memory cache, TypeBox-validated. Two files under `~/.claude/channels/vk/`:

- `access.json` — `dmPolicy`, `mentionPatterns`, chats, group senders + mention policies, pending pair codes. Hot-reloaded via `fs.watch`.
- `peers.json` — VK user/group metadata (TTL 1h, LRU 10k).

**Access + mention.** Gate ([access/access.gate.ts](server/src/modules/access/access.gate.ts)): chat allowlist → per-chat senders + mention policy (group chats only). Gate on **`from_id`, not `peer_id`** (PRD §9.4). `dmPolicy` (`pairing`/`allowlist`) is DM-only; groups opt in by `peerId`. Mention detection ([access/mention.ts](server/src/modules/access/mention.ts)) matches `[club{ID}|...]`, `@<screen_name>`, root `mentionPatterns`, or quote-reply (restart-safe via `reply_message.from_id === -communityId`). Permission relay DMs the first `kind: "dm"` in `access.json`. Full surface in [ACCESS.md](ACCESS.md).

**Inbound.** [inbound/long-poll.service.ts](server/src/modules/inbound/long-poll.service.ts) wraps `vk-io`'s `updates.start()` with a connect-backoff loop (1s→30s, code 5 fatal). Pipeline: `mention enrich → gate → (drop | DM pair | permission verdict | download + notify)`. Group chats are silently dropped until added; default to `mention_only`. Never throws — failures are logged, poll continues.

**Peer IDs.** `peer_id ≥ 2_000_000_000` = group chat. Use `isGroupChat()` from [common/utils/peer.ts](server/src/common/utils/peer.ts).

## Conventions

- Path alias `@/*` → `server/src/*`. Import from concrete files, never barrels.
- Strict TS + `noUncheckedIndexedAccess`. Assert `!` only when bound is obvious one line up.
- `export interface` for object shapes; reserve `type` for unions/intersections.
- `tsyringe` `@injectable()` / `@singleton()`; `bootstrapContainer` is for non-class registrations only.
- Logger: `import { logger } from "@/common/logger"` — never via DI.
- Errors extend `PluginError` with a stable `code`; `VkApiError` derives `vk_api_<n>`.
- `MessagingService.send` pushes every outbound `cmid` into `RecentSentMessages` so reply-to-bot resolves.
- No emojis in code or commits unless asked.
- Comments: inline comments only when the **why** is non-obvious (hidden constraint, subtle invariant, workaround) — one short line, never a paragraph. JSDoc on exported functions/classes/types: concise one-liner stating intent; add `@param`/`@returns` only when the name doesn't already convey it. Never restate what the code does.
