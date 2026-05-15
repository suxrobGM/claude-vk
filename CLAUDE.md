# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`claude-vk` is a Claude Code **channel plugin** that bridges VK.com (community DMs and group chats) into a Claude session. It is a single Bun process exposing an MCP stdio server _and_ an ElysiaJS HTTP listener on `127.0.0.1:6060`. The MCP surface declares `experimental.claude/channel` and (opt-in) `claude/channel/permission`.

The PRD at [docs/prd.md](docs/prd.md) is the source of truth for design decisions, milestones, and the access-control model. Read §5 (architecture), §7 (repo layout), §9 (inbound flow), and §11 (access) before doing non-trivial work. Current branch is mid-M1 — outbound messaging works; inbound/access/group-chat support land in later milestones.

## Commands

Run from repo root unless stated otherwise. The repo is a Bun workspaces monorepo with a single workspace under `apps/plugin`.

- `bun run dev` — start the plugin with `--watch` (MCP stdio + Elysia on `:6060`).
- `bun run start` — start without watch.
- `bun run test` — runs `bun test` across all workspaces. `*.test.ts` files are colocated next to source.
- `bun run typecheck` — `tsc --noEmit` across all workspaces.
- Single-file tests: `bun test apps/plugin/src/vk/rate-limiter.test.ts` (or any path).
- Single-test filter: `bun test -t "<name pattern>"`.
- `bun install` from root installs all workspace deps.

Pre-commit runs `lint-staged` → `prettier --write` via husky. Don't bypass it.

## Architecture

### Process shape

[apps/plugin/src/app.ts](apps/plugin/src/app.ts) is the **only composition point**. In order it:

1. `bootstrapContainer()` — tsyringe DI root (currently a no-op guard; class services use `@injectable()`/`@singleton()` and resolve by constructor).
2. `startMcpServer()` — creates the MCP server, calls `registerAllTools(server)`, attaches a `StdioServerTransport`, flips `ready=true`.
3. Boots Elysia, mounts each module's `*.controller.ts`, binds the listener.

The MCP server's `instructions` string is what Claude reads to learn the tool surface — keep it accurate when adding tools.

### Infrastructure vs feature modules

`src/` splits into infrastructure folders and feature modules. **Infrastructure never imports from `modules/`.**

- **Infrastructure** — `mcp/` (server lifecycle, tool registration), `state/` (generic `JsonStore<T>`, path resolution), `vk/` (vk-io wrapper + token-bucket rate limiter + text chunking), `common/` (logger, errors, DI container, peer-id helpers).
- **Feature modules** — flat folders under `modules/`. Each module owns its services, `*.schema.ts` (TypeBox + zod), `*.controller.ts` (Elysia plugin, if any HTTP surface), and `*.tools.ts` (MCP tool registration class, if any MCP surface). See [docs/prd.md §7.1](docs/prd.md) for naming rules.

Currently implemented: `modules/health/`, `modules/ping/`, `modules/messaging/`. The other module folders (`access/`, `admin/`, `history/`, `inbound/`, `permission-relay/`, `users/`) are `.gitkeep`-only placeholders for upcoming milestones — don't be surprised when they're empty.

### MCP tool registration

Tools are registered by their owning module via a `*Tools` class (`@injectable()`), composed in [apps/plugin/src/mcp/register-tools.ts](apps/plugin/src/mcp/register-tools.ts). Add a new tool by:

1. Define the input shape in `{module}.schema.ts` (zod for MCP input; TypeBox if it also goes through Elysia).
2. Implement the service method returning `{ ok: true, ... }`.
3. Add a `register(server)` method on the module's `*Tools` class wrapping the service with `toCallResult` (or equivalent envelope).
4. Add `container.resolve(YourTools).register(server)` to `register-tools.ts`.

Tool handlers **never throw** to MCP. All errors collapse into a `{ ok: false, code, message }` envelope — see `runWithEnvelope` in [apps/plugin/src/modules/messaging/messaging.service.ts](apps/plugin/src/modules/messaging/messaging.service.ts) for the pattern. `VkApiError`/`PluginError` surface their `code`; anything else becomes `internal_error`. Throwing across the MCP boundary would close the connection.

### VK client + rate limiter

[apps/plugin/src/vk/client.ts](apps/plugin/src/vk/client.ts) is a `@singleton()` over vk-io. It lazily constructs the `VK` instance on the first call, so the process boots cleanly without `VK_TOKEN` set — `/healthz` and `ping` stay reachable during initial setup. Tools surface `vk_token_missing` as a structured envelope at call time.

Every API method is wrapped through `RateLimiter.withRetry` ([apps/plugin/src/vk/rate-limiter.ts](apps/plugin/src/vk/rate-limiter.ts)) — a token-bucket sized to VK's group quota (20 req/s). Retry policy: error 6 backs off `250ms × attempt` up to 5 attempts; error 9 is fatal; any other `APIError` rethrows as `VkApiError`. The limiter uses a sleep-loop instead of timers so `bun test` always exits cleanly — keep it that way.

For tests, depend on the `ApiContract` interface, not on `VkClient` directly.

### Config + env

[apps/plugin/src/env.ts](apps/plugin/src/env.ts) merges `~/.claude/channels/vk/.env` under `process.env` (shell wins), validates against a TypeBox schema, and writes defaults back to `process.env`. [apps/plugin/src/config.ts](apps/plugin/src/config.ts) wraps this in a `current()` accessor.

**Always call `current()` at use-time** — never capture the returned `Config` at module load. The PRD plans hot-reload on `.env` change, and captured references will go stale.

### State files (JSON, never SQLite)

All persistent state is human-readable JSON under `~/.claude/channels/vk/` (override via `VK_STATE_DIR`). [apps/plugin/src/state/json-store.ts](apps/plugin/src/state/json-store.ts) is the generic store — one instance per file, atomic writes (tmp + rename + `chmod 0600`), in-memory cache, write-serialization via an internal promise chain, TypeBox validation on load and update. Bad writes are rejected and the previous version stays live.

The store holds no domain knowledge — schemas live in the module that owns the data (e.g. `access.schema.ts` will own `access.json`).

### Peer IDs

VK convention: `peer_id ≥ 2_000_000_000` is a group chat; below that is a DM (user ID). Use [apps/plugin/src/common/peer.ts](apps/plugin/src/common/peer.ts) → `isGroupChat()` rather than open-coding the comparison.

### Access gate (designed, not yet implemented)

When implementing M2/M3/M4, gate inbound messages on **`from_id`, not `peer_id`** — the channels reference is explicit about this, and group chats let any member inject prompts otherwise. The two-layer model (chat allowlist + per-chat sender allowlist + group-chat mention policy) is specified in [docs/prd.md §9.4 + §11](docs/prd.md).

## Conventions

- Path alias `@/*` → `apps/plugin/src/*`. Use it instead of long relative imports.
- TypeScript is strict + `noUncheckedIndexedAccess`. Array access returns `T | undefined`; assert with `!` only when the bound is obvious one line up.
- `tsyringe` decorators require `reflect-metadata` (imported once at the top of `common/di/container.ts`). Class services use `@injectable()` or `@singleton()`. Don't register classes manually in `bootstrapContainer` — that function is reserved for non-class value registrations.
- Logging: `import { logger } from "@/common/logger"`. Pino, pretty in dev, JSON in prod. Don't go through DI for the logger.
- Errors: extend `PluginError` with a stable `code` string. `VkApiError` synthesizes `vk_api_<n>` codes from VK's numeric `error_code`.
- Tests are colocated `*.test.ts`. Use `resetContainer()` from `common/di` when a test needs to re-bootstrap.
- No emojis in code or commit messages unless the user explicitly asks.

## Platform notes

Developed on Windows (PowerShell). The codebase intentionally no-ops `chmod` failures on Windows (see `json-store.ts` and `env.ts`) — don't add hard-fails there.
