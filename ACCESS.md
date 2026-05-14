# VK channel — access control

> **Placeholder.** Filled in during M3 (DM pairing + allowlist) and M4 (group chats + mention policy).

See `docs/PRD-vk-plugin.md` §11 for the designed access model:

- Two-layer gate: chat allowlist _and_ per-chat sender allowlist.
- Policy is set per peer-type (`dm` vs `group_chat`): `pairing` | `allowlist` | `open`.
- Group chats add a `mention_policy` activation layer (`mention_only` default).

The schema for `~/.claude/channels/vk/access.json` is documented in PRD §11.2.
