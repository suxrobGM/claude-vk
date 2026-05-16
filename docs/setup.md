# Setup walkthrough

End-to-end setup for `claude-vk`. Quick-start is in the
[README](../README.md); this page is the full version.

## 1. Configure the VK community

vk.com → **Manage** → **Create community** (or use an existing one).

In **Manage**:

- **Messages** → enable **Community messages** + **Bot capabilities**.
- **Messages → Settings for bot** → check **Allow adding to chats** if you
  want group-chat support.
- **API usage → Access tokens** → **Create token** with scopes:
  - `messages` — read/write DMs and group-chat messages.
  - `photos` — photo upload.
  - `docs` — document upload.
  - `manage` — `groups.getById`, long-poll bookkeeping.

  Skip everything else.

- **API usage → Long Poll API** → **Enabled**, API version **≥ 5.199**,
  check **`message_new`** under events. Without this the connect loop
  sits in backoff forever.

Copy the access token.

### Privacy mode (group chats only)

VK filters messages **before** they reach the long-poll. Two modes:

- **"Read all messages" off** (default) — VK delivers only `@`-mentions
  and quote-replies. Good fit for the default `mention_only` policy.
- **"Read all messages" on** — VK delivers everything in the chat.
  Required if you want `mentionPolicy=all` or [friendly mentions](../ACCESS.md#friendly-mentions-mentionpatterns)
  (`mentionPatterns`). **Bot must be admin in each group chat** —
  otherwise VK still filters non-mention messages.

## 2. Install the plugin

```text
/plugin marketplace add https://github.com/suxrobgm/claude-plugins
/plugin install vk@sukhrob-claude-plugins
```

The marketplace lives in [`claude-plugins`](https://github.com/suxrobgm/claude-plugins)
and ships pre-bundled artifacts — no `bun install` needed.

## 3. Save the token + launch

```text
/vk:configure <your-token>
```

Writes `VK_TOKEN=...` to `~/.claude/channels/vk/.env` (mode `0600`).
You can append `PORT=6060` or `LOG_LEVEL=info` later. Shell env always
wins on conflict.

Then exit your current session and relaunch with the channel attached:

```bash
claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins
```

Required until the plugin is on Anthropic's curated allowlist. Approve
the confirmation prompt on first launch.

## 4. Pair your DM

DM the community on VK. The bot replies with a 6-char code (10-min TTL).
In Claude:

```text
/vk:access pair <code>
```

`access.json` now lists your DM peer.

## 5. Add a group chat (optional)

Add the bot to a VK group chat, then opt it in by `peer_id` (find via
`/vk:status` — it lists recent dropped groups):

```text
/vk:access group add <peer_id>
/vk:access group add <peer_id> --allow id1,id2 --mention-policy reply_only
```

Adjust after the fact:

```text
/vk:access add-sender <peer_id> <id-or-@screen_name>
/vk:access mention-policy <peer_id> all
```

Group chats never pair — always opt-in by `peer_id`.

## 6. Lock down (optional)

DMs default to `pairing`. Once everyone you want is paired:

```text
/vk:access policy allowlist
```

Under `allowlist`, unknown DMs get one "ask the operator" reply per 24h.
Group chats are always opt-in, so unknown group messages are silently dropped.

## 7. Verify

```text
/vk:status
```

Look for `connected: true` and a recent `last event` timestamp. If
`connected: false`, see [troubleshooting.md](troubleshooting.md).
