/**
 * Maps a `PluginError.code` (and, for `vk_api_*`, the numeric VK code) to a
 * short human-facing hint appended to the envelope `message`. Returns `null`
 * when the raw VK error message already carries everything useful.
 */
export function humanizeError(code: string, vkErrorCode?: number): string | null {
  if (code === "config_invalid") {
    return "Plugin config is invalid. See `~/.claude/channels/vk/log/` and re-run `/vk:configure`.";
  }
  if (code === "access_denied") {
    return "Sender is not in the chat's allowlist. Add them with `/vk:access add-sender <peer_id> <user_id>`.";
  }

  if (code.startsWith("vk_api_") && typeof vkErrorCode === "number") {
    return vkApiHint(vkErrorCode);
  }
  return null;
}

function vkApiHint(vkErrorCode: number): string | null {
  switch (vkErrorCode) {
    case 5:
      return "VK rejected the token. Generate a new one with the `messages, photos, docs, manage` scopes, then run `/vk:configure <token>` and restart.";
    case 6:
      return "VK is rate-limiting this token (error 6). The plugin auto-retries up to 5 times; ask Claude to retry shortly.";
    case 9:
      return "VK flood-control fired (error 9). The peer may not have messaged this bot first, or you're sending too fast.";
    case 100:
      return "VK rejected the request parameters (error 100). Check `peer_id` and any IDs you passed.";
    case 901:
      return "User has blocked direct messages from communities (privacy setting). Ask them to allow community DMs.";
    case 917:
      return "Bot doesn't have access to this group chat (error 917). Make sure it was added and is still a member.";
    default:
      return null;
  }
}
