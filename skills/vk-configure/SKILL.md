---
name: vk-configure
description: Set up the VK channel — save the community token and community ID. Use when the user pastes a VK community token, asks to configure VK, asks "how do I set this up", or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /vk:configure — VK Channel Setup (M0 placeholder)

Writes VK credentials to `~/.claude/channels/vk/.env`. The server hot-reloads
changes — no restart needed when you edit `VK_COMMUNITY_ID` later.

Arguments passed: `$ARGUMENTS`

---

## M0 status

The plugin currently ships the **skeleton only**: MCP server, `ping` tool,
Elysia `/healthz`. Real configuration (token + community ID + transport
selection) arrives in M1.

For now, this skill reports status:

1. Read `~/.claude/channels/vk/.env` (may not exist yet).
2. If absent, tell the user: _"The VK plugin is in M0 (skeleton). Run `ping`
   from your Claude session to confirm the channel is connected. M1 will add
   `VK_TOKEN` + `VK_COMMUNITY_ID` and outbound messaging."_
3. If present, list which `VK_*` keys are set without revealing the token.

## Future shape (M1+)

```
/vk:configure <community_id> <token>
/vk:configure --callback https://vk.example.com/webhook/vk
```

Writes `VK_TOKEN`, `VK_COMMUNITY_ID`, `VK_TRANSPORT`, `VK_WEBHOOK_SECRET` to
the `.env` file. Shell env still overrides on first load.
