import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

/**
 * Capabilities declared on every connection. Permission relay (M7) extends
 * `experimental` with `claude/channel/permission` when enabled in .env.
 */
export function buildCapabilities(): ServerCapabilities {
  return {
    experimental: {
      "claude/channel": {},
    },
    tools: {},
  };
}
