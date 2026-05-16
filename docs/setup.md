# Setup walkthrough

End-to-end setup for `claude-vk` — from creating a VK community to a paired, locked-down channel. Quick-start lives in the [README](../README.md); this page is the full version.

## 1. Create a VK community

vk.com -> **Manage** -> **Create community**. Name it whatever your bot identity should be ("Claude VK Bridge" is fine).

If you want the bot to sit in multi-user group chats, also flip on **Allow adding to chats** in the community settings.

## 2. Enable bot capabilities

In the new community: **Manage** -> **Messages** -> turn on **Community messages**. Then open **Bot capabilities** and turn it on.

## 3. Mint an access token

**Manage** -> **Additional Settings** -> **API usage** -> **Access tokens** -> **Create token**. Required scopes:

- `messages` — read + write DMs and group-chat messages.
- `photos` — upload photo attachments.
- `docs` — upload document attachments.
- `manage` — `groups.getById`, long-poll bookkeeping.

Do **not** grant `wall`, `offline`, `friends`, or any scope you don't see used by the plugin. Tokens are mode-`0600` on disk, but principle of least privilege still applies.

Copy the token. You'll paste it into `/vk:configure` in step 7.

## 4. Enable Bots Long Poll

**Manage** -> **Additional Settings** -> **API usage** -> **Long Poll API**:

- Set the toggle to **Enabled**.
- API version: **at least `5.199`**.
- Under **Event types**, check **`message_new`**. Other events are ignored; checking them is harmless.

Without this step, `groups.getLongPollServer` returns no server URL and the plugin's connect loop sits in backoff forever.

## 5. Privacy mode (group-chat operators only)

For group chats, you generally want VK to deliver only mentions and replies-to-bot — not every message. Keep "Read all messages" **off** in the community's bot settings. The plugin's `mentionPolicy` is the second layer of the same filter; both off is the secure default.

## 6. Install the plugin

In any Claude Code session:

```text
/plugin marketplace add https://github.com/suxrobgm/claude-plugins
/plugin install vk@sukhrob-claude-plugins
```

The marketplace lives in a separate repo, [`claude-plugins`](https://github.com/suxrobgm/claude-plugins), which ships pre-bundled plugin artifacts — no `bun install` step on the user's machine. The `vk` plugin source (this repo) is built and synced into `claude-plugins/plugins/vk/` on each release.

## 7. Save the token

```text
/vk:configure <your-token>
```

Writes `VK_TOKEN=<your-token>` to `~/.claude/channels/vk/.env` (mode `0600`). You can also drop `PORT=6060` or `LOG_LEVEL=info` into the same file later.

The plugin reads this file at startup. Shell env always wins on conflict: `VK_TOKEN=... claude ...` overrides the file.

## 8. Relaunch with the channel attached

Exit your current session and start a new one:

```bash
claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins
```

The `--dangerously-load-development-channels` flag is required while `claude-vk` isn't on Anthropic's curated allowlist. Combining it with `--channels` does **not** extend the bypass — pick one.

Claude Code prompts for confirmation on first launch. Approve it.

## 9. Pair your DM peer

DM your community on VK. The bot replies with a 6-character pairing code (10-minute TTL). In Claude:

```text
/vk:access pair <code>
```

`access.json` now contains your DM peer with your `user_id` in its sender list.

## 10. Add a group chat (optional)

Add the bot to a VK group chat, then opt the chat in by `peer_id` from Claude:

```text
/vk:access group add <peer_id>
```

VK group-chat peer ids are `>= 2_000_000_000`. The chat now appears in `access.json` with `senders=[]` (anyone in the chat may write to the bot) and `mentionPolicy=mention_only`. Lock it down further with optional flags:

```text
/vk:access group add <peer_id> --allow id1,id2 --mention-policy reply_only
```

Or modify after the fact:

```text
/vk:access add-sender <peer_id> <user_id_or_@screen_name>
/vk:access mention-policy <peer_id> all
```

Group chats have no pairing flow — they're always opt-in by `peer_id`.

## 11. Lock down

DMs default to `pairing`. Once you've paired everyone you intend to allow, switch to `allowlist`:

```text
/vk:access policy allowlist
```

Under `allowlist`, unknown DMs get a single short "ask the operator" reply (rate-limited per sender, once per 24h). Group chats are already opt-in by `peer_id` — unknown group messages are always dropped silently.

## 12. Verify

Run:

```text
/vk:status
```

Expected output:

```text
VK channel
  connected:        true
  community:        @your_community  (id 123456789)
  last event:       2026-05-14T10:42:18Z
  policies:         dm=allowlist, group_chat=allowlist
  allowed chats:    2 (3 senders total)
  pending pairings: 0
```

If `connected: false`, see [troubleshooting.md](troubleshooting.md).
