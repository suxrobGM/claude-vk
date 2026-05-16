# claude-vk

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Plugin version](https://img.shields.io/badge/plugin-v1.0.0-blue)](.claude-plugin/plugin.json)

A Claude Code **channel plugin** that bridges [VK.com](https://vk.com) into your Claude session. DMs and group chats become `<channel>` notifications; Claude gets MCP tools to send, edit, react, fetch history, search, and upload attachments. Permission-gated tool calls can be approved or denied from VK itself - useful when you're away from your terminal.

## Prerequisites

- [Bun](https://bun.sh)
- [Claude Code](https://code.claude.com)
- A VK community you can administer (free to create at vk.com -> Manage -> Create community)

## Quick setup

> Detailed walkthrough: [docs/setup.md](docs/setup.md).

1. **Create a VK community + access token.** vk.com → Manage → Create community. In **Manage → Messages**, enable "Community messages" and "Bot capabilities" (turn on "Allow adding to chats" if you want group-chat support). In **Manage → Additional Settings → API usage → Access tokens**, mint a token with scopes `messages, photos, docs, manage`. Copy it.
2. **Enable Bots Long Poll.** **Manage → Additional Settings → API usage → Long Poll API** → enabled, API version `≥ 5.199`, check `message_new`.
3. **Install the plugin** from this marketplace:

   ```text
   /plugin marketplace add https://github.com/suxrobgm/claude-plugins
   /plugin install vk@claude-plugins
   /reload-plugins
   ```

4. **Save the token.**

   ```text
   /vk:configure <your-token>
   ```

   Writes to `~/.claude/channels/vk/.env`.

5. **Relaunch Claude with the channel attached.**

   ```text
   claude --dangerously-load-development-channels plugin:vk@claude-plugins
   ```

   The dev flag is required while the plugin is not on Anthropic's curated allowlist.

6. **Pair.** DM the community on VK → bot replies with a 6-character code → in Claude:

   ```text
   /vk:access pair <code>
   ```

   Optional lock-down once paired:

   ```text
   /vk:access policy dm allowlist
   /vk:access policy group_chat allowlist
   ```

Run `/vk:status` to confirm the channel is connected.

## Features

- **Message history + search.** `get_conversation_history` and `search_messages` give Claude memory of past conversations — neither is available to Telegram bots.
- **Group chats with mention policy.** Add the bot to a VK group chat; it stays silent until `@`-mentioned (default) or replied to.
- **Permission relay.** When Claude wants to run a permission-gated tool, you get a DM with a 5-letter request ID. Reply `yes a7k4m` / `no a7k4m` from your phone.
- **Attachments auto-download** to `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/` so Claude can `Read` photos, docs, and voice messages.
- **Two-layer access gate.** Chat allowlist + per-chat sender allowlist — applied to both DMs and group chats. See [docs/access.md](docs/access.md).
- **Long-poll only.** No public URL, no reverse proxy, works behind NAT.

## MCP tools

| Tool                       | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `send_message`             | Send a message (auto-chunked at 4096 chars), with optional `reply_to`, `files`, `keyboard`. |
| `edit_message`             | Edit a previously-sent message (own messages, 24h window).                                  |
| `delete_message`           | Delete a message; `delete_for_all` within 24h.                                              |
| `react`                    | Add or replace a reaction (`messages.sendReaction`).                                        |
| `mark_read`                | Mark a peer's messages read up to a given message.                                          |
| `get_conversation_history` | Fetch up to 200 recent messages with attachments resolved.                                  |
| `search_messages`          | Full-text search across the community's conversations.                                      |
| `get_user_info`            | Resolve a `user_id` to display name + screen name (cached).                                 |
| `upload_attachment`        | Upload a file and return its VK attachment ref.                                             |
| `ping`                     | Connectivity probe; no token required.                                                      |

Full tool reference: [docs/tools.md](docs/tools.md).

## Slash commands

| Command         | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `/vk:configure` | Write `VK_TOKEN` to `~/.claude/channels/vk/.env`.                     |
| `/vk:access`    | Pair, list, add/remove senders, change policy, manage mention policy. |
| `/vk:status`    | Connection health, community handle, policies, chat + sender counts.  |

## Documentation

- [Full setup walkthrough](docs/setup.md)
- [Access control](docs/access.md)
- [MCP tool reference](docs/tools.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

[MIT](LICENSE) — © Sukhrob Ilyosbekov.
