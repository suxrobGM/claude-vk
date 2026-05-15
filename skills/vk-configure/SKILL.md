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

# /vk:configure — VK Channel Setup

Writes VK credentials to `~/.claude/channels/vk/.env`. The server hot-reloads
changes — no restart needed when you edit `VK_COMMUNITY_ID` later.

Arguments passed: `$ARGUMENTS`

---

## Flow

1. Read `~/.claude/channels/vk/.env` (may not exist yet) and report which
   `VK_*` keys are already set (mask `VK_TOKEN`).
2. If the user provided `<community_id> <token>` in arguments, write them.
3. After writing, `curl -s http://127.0.0.1:6060/admin/config` to confirm
   the running process has picked them up (`vk_community_id` populated,
   `vk_token: "***"`).
4. After the bot DMs the user a 6-character pairing code, finish setup with
   `/vk:access pair <code>`. See [vk-access](../vk-access/SKILL.md).

## Future shape (M6+)

```
/vk:configure --callback https://vk.example.com/webhook/vk
```

Sets `VK_TRANSPORT=callback` and `VK_WEBHOOK_SECRET`; prints the VK
confirmation string to paste into the community's Callback API settings.
