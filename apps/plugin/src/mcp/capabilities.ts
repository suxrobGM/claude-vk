import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { current as currentConfig } from "@/config";

/**
 * Capabilities declared on every connection. `claude/channel/permission` is
 * added only when `VK_PERMISSION_RELAY=true` — per the channels reference, the
 * capability MUST stay undeclared unless the channel can authenticate the
 * sender (which our access gate enforces, see PRD §15.2).
 */
export function buildCapabilities(): ServerCapabilities {
  const cfg = currentConfig();
  const experimental: Record<string, Record<string, never>> = {
    "claude/channel": {},
  };
  if (cfg.permissionRelay) {
    experimental["claude/channel/permission"] = {};
  }
  return {
    experimental,
    tools: {},
  };
}
