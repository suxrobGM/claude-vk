# claude-vk

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Plugin version](https://img.shields.io/badge/plugin-v1.5.2-blue)](.claude-plugin/plugin.json)

A Claude Code **channel plugin** that bridges [VK.com](https://vk.com) into your
Claude session. DMs and group chats arrive as `<channel>` notifications; Claude
gets MCP tools to send, edit, react, fetch history, search, and upload files.
Permission-gated tool calls can be approved or denied from VK itself — useful
when you're away from your terminal.

## Prerequisites

- [Bun](https://bun.sh)
- [Claude Code](https://code.claude.com)
- A VK community you can administer (free at vk.com → Manage → Create community)

## Quick setup

Detailed walkthrough: [docs/setup.md](docs/setup.md).

1. **Create a VK community and mint a token.** Manage → Messages: enable
   "Community messages" and bot capabilities. Manage → API usage → Access
   tokens: scopes `messages, photos, docs, manage`. Manage → API usage →
   Long Poll API: enable, add `messages` events.

2. **Install:**

   ```text
   /plugin marketplace add https://github.com/suxrobgm/claude-plugins
   /plugin install vk@sukhrob-claude-plugins
   /reload-plugins
   ```

3. **Save the token + launch with the channel:**

   ```text
   /vk:configure <your-token>
   claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins
   ```

   (Dev flag required until the plugin is on Anthropic's curated allowlist.)

4. **Pair a DM:** message the community on VK → bot replies with a 6-char code → in Claude:

   ```text
   /vk:access pair <code>
   ```

5. **Optional — add a group chat:**

   ```text
   /vk:access group add <peer_id>
   ```

   Find `peer_id` by inviting the bot, sending a message, then running `/vk:status`.

Run `/vk:status` to confirm the channel is connected.

## Features

- **Message history + search** — `get_conversation_history` and
  `search_messages` give Claude memory of past conversations.
- **Group chats with mention policy** — default `mention_only` keeps the bot
  silent until `@`-mentioned, quote-replied to, or addressed by a friendly name
  in `mentionPatterns` (e.g. `"claude"`, `"клод"`).
- **Permission relay** — Claude's permission prompts arrive in your DM with
  Allow/Deny inline buttons. Tap one to authorize.
- **Attachments auto-download** to `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/`
  so Claude can `Read` photos, docs, and voice messages.
- **Two-layer access gate** — chat allowlist + per-chat sender allowlist for
  DMs and group chats. DMs auto-pair; groups opt in by `peer_id`.
  See [ACCESS.md](ACCESS.md).
- **Long-poll only** — no public URL, no reverse proxy, works behind NAT.

## MCP tools

| Tool                       | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `send_message`             | Send a message (auto-chunked at 4096), with optional `reply_to`, `files`. |
| `edit_message`             | Edit a previously-sent message (own messages, 24h window).                |
| `delete_message`           | Delete a message; `delete_for_all` within 24h.                            |
| `react`                    | Add or replace a reaction.                                                |
| `mark_read`                | Mark a peer's messages read up to a given message.                        |
| `get_conversation_history` | Fetch up to 200 recent messages with attachments resolved.                |
| `search_messages`          | Full-text search across the community's conversations.                    |
| `get_user_info`            | Resolve a `user_id` to display name + screen name (cached).               |
| `upload_attachment`        | Upload a file and return its VK attachment ref.                           |
| `ping`                     | Connectivity probe; no token required.                                    |

Full reference: [docs/tools.md](docs/tools.md).

## Slash commands

| Command         | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `/vk:configure` | Save `VK_TOKEN` to `~/.claude/channels/vk/.env`.                     |
| `/vk:access`    | Pair, list, add/remove senders, change DM or mention policy.         |
| `/vk:status`    | Connection health, community handle, policies, chat + sender counts. |

## Documentation

- [Setup walkthrough](docs/setup.md)
- [Access control](ACCESS.md)
- [MCP tool reference](docs/tools.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

[MIT](LICENSE) — © Sukhrob Ilyosbekov.
