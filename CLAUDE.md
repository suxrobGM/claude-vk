# CLAUDE.md

## What this is

`claude-vk` is a Claude Code **channel plugin** bridging VK.com (DMs + group chats) into a session. Single Bun process: MCP stdio server + ElysiaJS on `127.0.0.1:6060`. MCP capability: `experimental.claude/channel` (+ opt-in `claude/channel/permission` in M7).

PRD: [docs/prd.md](docs/prd.md) — source of truth. M0–M5 shipped; M6 (Callback API), M7 (permission relay), M8 (polish) open.

## Commands

- `bun run dev` / `bun run start` — boot (watch / no-watch)
- `bun run test` — `bun test` across workspaces; `*.test.ts` colocated
- `bun run typecheck` — `tsc --noEmit`
- Single file: `bun test apps/plugin/src/vk/rate-limiter.test.ts`
- Single name: `bun test -t "<pattern>"`

Pre-commit: `lint-staged` → `prettier --write` via husky. Don't bypass.

## Architecture

**Composition.** [app.ts](apps/plugin/src/app.ts) is the only composition point: `bootstrapContainer()` → `startMcpServer()` (which calls `registerAllTools`) → mount each module's `*.controller.ts` on Elysia → `listen`.

**Infrastructure vs modules.** `mcp/`, `state/`, `vk/`, `common/` are infrastructure — never import from `modules/`. Feature modules under `modules/` are flat; one folder per concern, no further nesting. File suffixes: `*.controller.ts` (Elysia), `*.tools.ts` (MCP), `*.service.ts`, `*.schema.ts` (zod for MCP + TypeBox for persistent/HTTP shapes).

**Implemented modules:** `health`, `ping`, `messaging`, `access`, `admin`, `inbound`, `history`, `users`. `permission-relay` is `.gitkeep` until M7.

**MCP tools.** Each module has `@injectable() *Tools` with `register(server)`; [mcp/register-tools.ts](apps/plugin/src/mcp/register-tools.ts) resolves and calls each. To add: zod `*InputShape` in `*.schema.ts`, service method returning `{ ok: true, ... } | ToolFailure` wrapped in `runWithEnvelope`, `register(server)` call wrapping with `toCallResult`, container line. Both helpers live in [common/utils/tool-envelope.ts](apps/plugin/src/common/utils/tool-envelope.ts).

Tool handlers **never throw to MCP** — `VkApiError`/`PluginError` collapse to `{ ok: false, code, message }`; anything else becomes `internal_error`. Throwing closes the connection.

**VK surface (split for clarity).**

- [vk/api.ts](apps/plugin/src/vk/api.ts) — `VkApi` interface (depend on this in tests, not `VkClient`).
- [vk/api.types.ts](apps/plugin/src/vk/api.types.ts) — every `*Params` / `*Response` interface. No inline shapes.
- [vk/mappers.ts](apps/plugin/src/vk/mappers.ts) — coerce vk-io's loose responses.
- [vk/client.ts](apps/plugin/src/vk/client.ts) — `@singleton() VkClient implements VkApi`. Lazy `VK` ctor so `/healthz` works without `VK_TOKEN`. Every method routes through `this.run(fn)` → [`RateLimiter.withRetry`](apps/plugin/src/vk/rate-limiter.ts) (20 req/s token bucket; error 6 retries 5× w/ 250ms × attempt; error 9 fatal). Limiter uses a sleep-loop, not timers — keep it that way so `bun test` exits.

**Config.** [env.ts](apps/plugin/src/env.ts) merges `~/.claude/channels/vk/.env` under `process.env`; [config.ts](apps/plugin/src/config.ts) exposes `current()`. **Always call `current()` at use-time** — captured refs go stale under hot-reload.

**State (JSON, never SQLite).** [state/json-store.ts](apps/plugin/src/state/json-store.ts) is the generic store: atomic tmp+rename writes, in-memory cache, serialized writes, TypeBox validation on load + update. Bad writes are rejected; previous version stays live. Schemas live with the module that owns the file.

**Access + mention.** Three-layer gate in [access/access.gate.ts](apps/plugin/src/modules/access/access.gate.ts): chat allowlist → per-chat senders → mention-policy (group chats only). Gate on **`from_id`, not `peer_id`** (PRD §9.4). Mention signals in [access/mention.ts](apps/plugin/src/modules/access/mention.ts) — `name_mention` (`[club{ID}|...]` or `@screen_name`), `reply_to_bot` (cmid in `state.recent_messages`), `keyboard_payload` (M7). `isPairCommand` requires explicit `@<community> pair` — group chats never auto-emit codes.

**Inbound.** [inbound.service.ts](apps/plugin/src/modules/inbound/inbound.service.ts): `normalize → mention enrich → gate → (drop | pair | download + notify)`. Never throws — long-poll continues on per-message failures. Notifier emits `<channel source="vk" ...>` with `mentioned` + `reply_to_bot` meta. Group chats default to `mention_only`.

**Peer IDs.** `peer_id ≥ 2_000_000_000` = group chat. Use `isGroupChat()` from [common/utils/peer.ts](apps/plugin/src/common/utils/peer.ts).

## Conventions

- Path alias `@/*` → `apps/plugin/src/*`.
- Strict TS + `noUncheckedIndexedAccess`. Assert `!` only when bound is obvious one line up.
- Object shapes: `export interface`, not `export type X = {...}`. Reserve `type` for unions/intersections.
- `tsyringe` services use `@injectable()` / `@singleton()`. `bootstrapContainer` is for non-class value registrations only.
- Logger: `import { logger } from "@/common/logger"` — never via DI.
- Errors: extend `PluginError` with a stable `code`. `VkApiError` derives `vk_api_<n>` from VK's numeric code.
- `MessagingService.send` feeds every outbound `cmid` into `StateStore.pushRecentMessage` so reply-to-bot can resolve it.
- No emojis in code or commits unless asked.

## Platform notes

Developed on Windows (PowerShell). `chmod` failures are no-oped on Windows in `json-store.ts` + `env.ts` — don't hard-fail there.
