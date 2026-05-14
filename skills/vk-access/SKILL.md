---
name: vk-access
description: Manage VK channel access — pair new chats, edit allowlists, set policy. Use when the user wants to pair, approve a sender, list allowed chats, or change policy for the VK channel.
user-invocable: true
allowed-tools:
  - Read
  - Write
---

# /vk:access — VK Channel Access Control (M0 placeholder)

Manages `~/.claude/channels/vk/access.json`. **Not yet implemented in M0.**

Lands in **M3** (DM pairing + allowlist) and **M4** (group chats + per-chat
sender allowlist + mention policy). See `docs/PRD-vk-plugin.md` §11 for the
final schema.

For M0, this skill should report:

> The VK channel is in M0 (skeleton). Access control arrives in M3. Until then
> the plugin does not forward inbound messages — it only exposes the `ping`
> MCP tool.
