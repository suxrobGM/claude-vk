# Troubleshooting

## First step: `/vk:status`

Aggregates `/healthz`, `/state`, `/access/*`. Two key fields:

- `connected` — is the long-poll loop running?
- `lastError` — most recent failure, if any.

Raw equivalents: `http://127.0.0.1:6060/healthz`, `/state`, `/config`.

If `/vk:status` itself fails, the plugin isn't running — relaunch:

```bash
claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins
```

## Symptoms

### `lastError: "VK_TOKEN missing"`

No token. Run `/vk:configure <token>` and restart Claude (`.env` is read at
startup only). Same diagnosis is also pushed as a `<channel>` warning on launch.

### `lastError` starts with `vk_api_5`

VK rejected the token. Most likely:

1. Token deleted/expired.
2. Missing scopes — need `messages, photos, docs, manage`.
3. Token belongs to a different community.

Fix: vk.com → Manage → API usage → Access tokens → generate fresh →
`/vk:configure <new-token>` → restart.

### `lastError: "start failed (attempt N)"`

Can't reach VK's long-poll server:

1. **Long Poll API disabled.** Manage → API usage → Long Poll API: on,
   version `>= 5.199`, `message_new` checked. (After 3 fails the plugin
   emits a `<channel>` warning saying exactly this.)
2. **Outbound HTTPS blocked.** Allow `*.vk.com` and `*.userapi.com` on 443.
3. **Wrong community type.** Must be **Group** — Page/Event don't expose the message API.

### Bot doesn't reply in a group chat

In order:

1. **Chat allowlisted?** `/vk:access list`. Add: `/vk:access group add <peer_id>`.
2. **Sender listed?** `/vk:access list <peer_id>`. Add: `/vk:access add-sender <peer_id> <your_id>`.
3. **Message activates the chat?** Default `mention_only` ignores everything that
   isn't `@<community>`, a `mentionPatterns` hit, or a quote-reply to the bot.
   Either mention explicitly, add a friendly name to `mentionPatterns`
   (e.g. `["claude", "клод"]`), or `/vk:access mention-policy <peer_id> all`.
4. **VK privacy mode hiding it?** "Read all messages" off → VK only delivers
   mentions/replies. Fine with `mention_only`; turn on for `all`.

### Pairing code never arrives

1. Token missing `messages` scope.
2. Long-poll not connected (`/vk:status` shows `connected: false`).
3. You blocked the community in VK.
4. `dmPolicy` isn't `pairing` — switch with `/vk:access policy pairing`.

### "This bot is locked to specific users" reply

`dmPolicy=allowlist` and you're not on it. Operator runs
`/vk:access add-sender <peer_id> <your_id>`. Further DMs within 24h are
silently dropped (per-sender rate limit).

### Permission prompts go to terminal instead of VK

No paired DM in `access.json`. Pair one via `/vk:access pair <code>`.
Prompts route to the first `kind: "dm"` entry — no in-memory state required.

### Attachments missing from `inbox/`

Check `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/`. Empty dir → look for
`attachment-download-failed` in `~/.claude/channels/vk/log/` (usually a VK
CDN hiccup). Re-fetch via `get_conversation_history` for the same `peer_id`.

### Tool returns `internal_error`

Unknown server-side exception. Stack is in `~/.claude/channels/vk/log/`.
File an issue with the redacted excerpt.

### `/vk:configure` saved but `connected` stays false

`.env` is read at startup. Restart Claude. (`/healthz` reports ok regardless
because the HTTP layer doesn't depend on the token.)

## Where things live

| Thing                  | Path                                                        |
| ---------------------- | ----------------------------------------------------------- |
| Token, port, log level | `~/.claude/channels/vk/.env`                                |
| Allowlist + pairings   | `~/.claude/channels/vk/access.json`                         |
| User cache             | `~/.claude/channels/vk/peers.json`                          |
| Attachments            | `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/`             |
| Logs (Pino, rotated)   | `~/.claude/channels/vk/log/`                                |
| Admin endpoints        | `http://127.0.0.1:6060/{config,state,access/*}`, `/healthz` |

## Reset everything

Stop Claude:

```bash
rm -rf ~/.claude/channels/vk
```

Wipes token, allowlist, cache, attachments, logs. Reinstall with
`/vk:configure <token>` and re-pair. Plugin code (under `~/.claude/plugins/`)
is untouched.
