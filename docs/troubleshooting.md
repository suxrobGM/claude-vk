# Troubleshooting

## Diagnose first

Run `/vk:status` — it aggregates `/healthz`, `/state`, `/access/*` into one block. The two fields that matter most:

- `connected` — is the long-poll loop running?
- `last_error` — most recent failure recorded by the loop, if any.

If `/vk:status` itself errors out, the plugin isn't running. Relaunch:

```bash
claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins
```

If you'd rather skim raw output, the same data is at `http://127.0.0.1:6060/healthz`, `/readyz`, `/state`, `/config`.

## Common symptoms

### `connected: false`, `last_error: "VK_TOKEN missing"`

The plugin booted, found no token, and parked. Run `/vk:configure <token>` and restart your Claude session. The long-poll loop only resolves config at startup.

You should also see this as a `<channel severity="warning">` message in Claude on first launch — that's the same diagnosis pushed through the channel.

### `connected: false`, `last_error` starts with `vk_api_5`

VK rejected the access token. Causes (most common first):

1. Token was deleted or expired in the community admin.
2. Token is missing required scopes (`messages, photos, docs, manage`).
3. Token belongs to a different community than the one you intend to bridge.

Fix: vk.com -> Manage -> API usage -> Access tokens -> generate a new one with the right scopes -> `/vk:configure <new-token>` -> restart.

### `connected: false`, `last_error: "start failed (attempt N)"`

The plugin couldn't reach VK's long-poll server. Causes:

1. **Long Poll API is not enabled.** Most common. Check **Manage -> API usage -> Long Poll API**: toggle on, version `>= 5.199`, `message_new` checked. After three failed attempts the plugin emits a `<channel>` warning describing this.
2. **No outbound HTTPS.** The plugin connects to `api.vk.com` and the VK-supplied poll server. If you're behind a firewall, allow outbound 443 to `*.vk.com` and `*.userapi.com`.
3. **Community type doesn't support bot capabilities.** Make sure the community is **Group** (Page / Event don't allow message API access in the same way).

### Bot doesn't reply in a group chat

Walk through these in order:

1. **Is the chat allowlisted?** `/vk:access list` should show its `peer_id`. If not, opt the group in: `/vk:access group add <peer_id>` (group chats no longer pair — they have to be added explicitly by `peer_id`).
2. **Is your user listed for that chat?** `/vk:access list <peer_id>`. Add yourself: `/vk:access add-sender <peer_id> <your_user_id>`.
3. **Is the message activating the chat?** Default `mention_policy` is `mention_only` — the bot ignores everything that isn't `@<community>` or a reply to one of its own messages. Mention it explicitly, or change policy: `/vk:access mention-policy <peer_id> all`.
4. **Is privacy mode hiding the message from VK?** In community settings, "Read all messages" off means VK only delivers mentions and replies. That's fine if your `mention_policy` agrees, but if you want everything, turn it on.

### Pairing code never arrives

You DM'd the bot and got nothing back. Causes:

1. **Token missing `messages` scope.** Regenerate with `messages, photos, docs, manage`.
2. **Long-poll not connected.** `/vk:status` will show `connected: false`. Fix that first.
3. **You blocked the bot.** Unblock the community in VK settings.
4. **Allowlist policy + DM not on the list.** Pairing only emits codes under `pairing` policy. Switch back temporarily: `/vk:access policy pairing`.

### "This bot is locked to specific users" reply

You're DMing a bot whose DM policy is `allowlist` and you're not on the list. Ask the operator to run `/vk:access add-sender <peer_id> <your_user_id>`. Subsequent DMs within 24h are silently dropped (per-sender rate limit).

### Attachments missing from `inbox/`

Check `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/`. If the directory exists but is empty, look in `~/.claude/channels/vk/log/` for `attachment-download-failed` warnings — usually a VK CDN hiccup. Re-fetch by asking Claude to call `get_conversation_history` for the same `peer_id` — attachments resolve to local paths there too.

### Tool returns `internal_error`

Unknown server-side exception. The log carries the stack: `~/.claude/channels/vk/log/`. File an issue with the redacted log excerpt.

### `/vk:configure` says the token saved but `connected` stays false

The plugin reads `.env` at **startup**, not on every request. After `/vk:configure`, exit and relaunch Claude. (`/healthz` will still report ok because the HTTP layer doesn't depend on the token.)

## Where things live

| Thing                      | Path                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| Token + port + log level   | `~/.claude/channels/vk/.env`                                           |
| Allowlist + pairings       | `~/.claude/channels/vk/access.json`                                    |
| User cache                 | `~/.claude/channels/vk/peers.json`                                     |
| Downloaded attachments     | `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/`                        |
| Logs (Pino, daily-rotated) | `~/.claude/channels/vk/log/`                                           |
| Local management endpoints | `http://127.0.0.1:6060/{config,state,access/*}`, `/healthz`, `/readyz` |

## Reset everything

Stop Claude, then:

```bash
rm -rf ~/.claude/channels/vk
```

This wipes token, allowlist, cache, attachments, and logs. Reinstall: `/vk:configure <token>` and `/vk:access pair ...` from scratch. The plugin itself (under `~/.claude/plugins/`) is untouched.
