---
name: vk-status
description: Show VK channel status — transport, connection health, community handle, policies, chat count. Use when the user asks "is VK connected?", "what's the status of VK?", or wants a health summary.
user-invocable: true
allowed-tools:
  - Bash(curl http://127.0.0.1:6060/healthz)
  - Bash(curl http://127.0.0.1:6060/readyz)
  - Read
---

# /vk:status — VK Channel Status (M0)

Reports health of the running VK plugin.

## M0 implementation

1. `curl -s http://127.0.0.1:6060/healthz` — should return `{"ok":true}`.
2. `curl -s http://127.0.0.1:6060/readyz` — returns `{"ok":true,"mcp":true}`
   once the MCP transport is connected.
3. Read `~/.claude/channels/vk/.env` (if present) and report which `VK_*`
   keys are set (mask `VK_TOKEN`).

If either probe fails, tell the user the plugin isn't running and remind them
to launch with `claude --dangerously-load-development-channels plugin:vk@suxrobgm/claude-vk`.

## Future shape (M2+)

Adds: long-poll connection health, last inbound message timestamp, community
handle, policy summary, sender count per chat, last VK API error.
