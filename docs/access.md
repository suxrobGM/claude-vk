# Access control

`claude-vk` gates every inbound message through a **two-layer allowlist**: the chat itself must be allowed, and within each allowed chat there is a per-chat list of trusted sender user IDs. The check runs on `from_id`, not `peer_id` — so a user trusted in a DM is not automatically trusted in a group chat.

Group chats get a third layer (activation) that decides which kinds of messages from an allowed sender actually wake Claude up.

## Policies

Set per peer-type (DM vs group chat). Defaults are `pairing` for both.

| Policy      | Behavior                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pairing`   | Unknown chats / senders receive a 6-character pairing code DM. The operator runs `/vk:access pair <code>` to add them. Default.                            |
| `allowlist` | Only the chats and senders listed in `access.json` are forwarded. DM denials reply with a one-time "ask the operator" note; group-chat denials are silent. |

Switch a policy:

```text
/vk:access policy dm allowlist
/vk:access policy group_chat allowlist
```

## `access.json`

Lives at `~/.claude/channels/vk/access.json`, mode `0600`. Hand-editable — the server hot-reloads on save and rejects malformed edits while keeping the previous version live.

```json
{
  "version": 1,
  "policies": {
    "dm": "allowlist",
    "group_chat": "allowlist"
  },
  "chats": {
    "123456": {
      "kind": "dm",
      "title": "Ivan Petrov",
      "senders": [123456],
      "added_at": "2026-05-14T10:21:00Z",
      "added_by": "pairing"
    },
    "2000000042": {
      "kind": "group_chat",
      "title": "Team Standup",
      "senders": [123456, 234567, 345678],
      "mention_policy": "mention_only",
      "added_at": "2026-05-14T11:02:00Z",
      "added_by": "pairing"
    }
  },
  "pending_pairs": {
    "X7K4MQ": {
      "peer_id": 2000000099,
      "from_id": 555444,
      "kind": "group_chat",
      "expires_at": "2026-05-14T11:30:00Z"
    }
  }
}
```

- Keys under `chats` are stringified `peer_id`s. DM peers are user IDs (`< 2_000_000_000`); group-chat peers are `>= 2_000_000_000`.
- `senders` is an array of VK user IDs. **An empty `senders` array means "no per-sender restriction" — anyone in the chat may message Claude.** Group-chat pairing leaves it empty by default (you trust the chat); add specific user IDs to lock it down. DM pairing seeds it with the DM peer's user ID for clarity (a DM has only ever one possible sender anyway).
- `mention_policy` (group chats): `mention_only` (default), `all`, or `reply_only`. See below. The mention layer still applies even when `senders` is empty.
- `pending_pairs` is the live pairing table. Codes are 6 chars from a 32-char alphabet (no `0/O/1/I/L`), TTL 10 minutes, single-use.

## Pairing flow

**DMs.** DM the community on VK -> the bot replies with a code. Run `/vk:access pair <code>` in Claude. The DM peer is added to `chats` and the sender's `user_id` to its `senders`.

**Group chats.** Adding the bot to a chat is not enough — it stays silent. Inside the chat, someone explicitly types `@<community_screen_name> pair`. The bot DMs that sender the code; running `/vk:access pair <code>` in Claude adds the chat's `peer_id` to `chats` with the inviting user as the only allowed sender. Add more with `/vk:access add-sender <peer_id> <user_id_or_@screen_name>`.

## Mention policy (group chats only)

Activation filter applied after the sender check. A non-mention from an allowed sender is silently dropped — it isn't an access denial.

| Policy                   | Forwards to Claude when...                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `mention_only` (default) | The message mentions `[club{ID}\|...]`, `@<screen_name>`, or replies to one of the bot's messages. |
| `all`                    | Every message from an allowed sender.                                                              |
| `reply_only`             | Only replies to one of the bot's own messages.                                                     |

Change it:

```text
/vk:access mention-policy <peer_id> mention_only
/vk:access mention-policy <peer_id> all
/vk:access mention-policy <peer_id> reply_only
```

## `/vk:access` sub-actions

The slash skill calls the local admin API at `http://127.0.0.1:6060/admin/access/*`. Full reference in [skills/access/SKILL.md](../skills/access/SKILL.md).

| Sub-action                          | Effect                                             |
| ----------------------------------- | -------------------------------------------------- |
| `pair <code>`                       | Consume a pending pairing code.                    |
| `list` / `list <peer_id>`           | List allowed chats; per-chat sender detail.        |
| `policy <peer_type> <policy>`       | Set `dm` or `group_chat` policy.                   |
| `add-sender <peer_id> <user>`       | Add user (numeric id or `@screen_name`) to a chat. |
| `remove-sender <peer_id> <user_id>` | Drop a sender from a chat.                         |
| `remove-chat <peer_id>`             | Drop a chat entirely.                              |
| `mention-policy <peer_id> <policy>` | Group chats only.                                  |
| `pending`                           | List outstanding pairing codes.                    |

## Hand-editing

Editing `access.json` directly is supported. The plugin watches the file via `fs.watch` and reloads on save. Each load is validated against the TypeBox schema — malformed edits are rejected with a `<channel>` warning and the previous version stays live.

## Group-chat specifics

- **Privacy mode.** Leave "Read all messages" **off** in the community admin unless you really need it. With it off, VK only delivers messages where the bot is mentioned or replied-to — a useful belt-and-braces alongside `mention_policy`.
- **Removed bot.** When the bot is kicked, VK emits a `chat_kick_user` event. The chat is marked inactive (kept for audit) and forwarding stops.
- **Sender management.** `add-sender` accepts numeric IDs and `@screen_name`. Screen names are resolved via `users.get` and stored as IDs.
