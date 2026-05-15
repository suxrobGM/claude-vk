import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

/**
 * Capabilities declared on every connection. The access gate authenticates
 * senders per PRD §15.2, which is the prerequisite for advertising
 * `claude/channel/permission`.
 */
export function buildCapabilities(): ServerCapabilities {
  return {
    experimental: {
      "claude/channel": {},
      "claude/channel/permission": {},
    },
    tools: {},
  };
}
