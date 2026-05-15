# MCP tool reference

Every tool returns a tagged envelope: `{ ok: true, ... }` on success, or `{ ok: false, code, message, vk_error_code? }` on failure. Tool handlers never throw to MCP — known errors collapse into structured failure; unknown errors collapse to `code: "internal_error"`. See [troubleshooting.md](troubleshooting.md) for common failure codes.

`peer_id` accepts both forms: a VK user id (`< 2_000_000_000`) for DMs or a group-chat id (`>= 2_000_000_000`).

## Messaging

### `send_message`

Send a message. Auto-chunks text at 4096 chars and feeds every resulting `conversation_message_id` into the recent-sent ring so `reply_to_bot` detection works.

```jsonc
// input
{
  "peer_id": 123456,
  "text": "Hello!",
  "reply_to": 789           // optional cmid; only applied to the first chunk
}

// success
{ "ok": true, "conversation_message_ids": [101] }
```

Common error codes: `vk_api_9` (flood control — peer hasn't messaged the bot first), `vk_api_901` (user blocked community DMs), `vk_api_917` (no access to group chat).

### `edit_message`

```jsonc
{ "peer_id": 123456, "conversation_message_id": 101, "text": "Edited" }
// success: { "ok": true }
```

VK enforces own-messages and a 24h window — both surface as `vk_api_*` failures.

### `delete_message`

```jsonc
{ "peer_id": 123456, "conversation_message_id": 101, "delete_for_all": true }
// success: { "ok": true }
```

`delete_for_all` only applies within VK's 24h window.

### `react`

```jsonc
{ "peer_id": 123456, "conversation_message_id": 101, "reaction_id": 1 }
// success: { "ok": true }
```

`reaction_id` is one of VK's enumerated set (positive integer). Calling `react` again with a different id replaces the previous reaction.

### `mark_read`

```jsonc
{ "peer_id": 123456, "start_message_id": 100 }
// success: { "ok": true }
```

Omit `start_message_id` to mark every unread message read.

### `upload_attachment`

Upload a local file and return its VK attachment reference (e.g. `photo123_456`). Pass the ref to `send_message` via `files` later.

```jsonc
{ "peer_id": 123456, "path": "/abs/path/to/photo.png", "kind": "auto" }
// success: { "ok": true, "vk_ref": "photo123456_789012" }
```

`kind` is one of `auto` (default — picks by extension), `photo`, `doc`, `voice`. 50 MB cap.

## History

### `get_conversation_history`

The headline VK-vs-Telegram differentiator: Claude can read past messages.

```jsonc
{
  "peer_id": 123456,
  "count": 20, // 1..200, default 20
  "offset": 0, // optional, paginate
  "start_message_id": 0, // optional, start before this message_id
  "extended": false, // resolve participants into profiles[]
}

// success: { "ok": true, "data": { items: [...], count: 20, profiles?: [...] } }
```

Attachments in returned messages carry `local_path` if previously downloaded into `~/.claude/channels/vk/inbox/`.

### `search_messages`

Full-text search across the bound identity's conversations.

```jsonc
{ "q": "deploy", "peer_id": 123456, "count": 20, "offset": 0 }
// success: { "ok": true, "data": { items: [...], count: 5 } }
```

`peer_id` is optional — omit to search globally. Subject to VK API search quotas.

## Users

### `get_user_info`

```jsonc
{ "user_ids": [123, 456, 789] }
// success: { "ok": true, "users": [{ id, name, screen_name?, photo?, cached_at }, ...] }
```

Up to 100 user IDs per call (VK's `users.get` cap). Backed by an in-memory + `peers.json` cache with a 1-hour TTL.

## Connectivity

### `ping`

Connectivity probe. No `VK_TOKEN` required — useful as a smoke test right after install.

```jsonc
{}
// success: { "ok": true, "pong": true }
```

## Failure envelope

Every failure looks like:

```jsonc
{
  "ok": false,
  "code": "vk_api_5",
  "message": "User authorization failed — VK rejected the token. Generate a new one with the `messages, photos, docs, manage` scopes, then run `/vk:configure <token>` and restart.",
  "vk_error_code": 5,
}
```

`message` includes a human-facing hint when one is available — see [`error-messages.ts`](../apps/plugin/src/common/utils/error-messages.ts) for the full map. Stable `code` values you can branch on: `vk_api_<n>`, `config_invalid`, `access_denied`, `internal_error`.
