import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { logger } from "@/common/logger";
import { CommunityResolver } from "@/modules/access/community-resolver";
import { startPermissionRelay } from "@/modules/permission-relay/permission-relay.startup";
import { InboundService } from "./inbound.service";
import { LongPollService } from "./long-poll.service";
import { ChannelNotifier } from "./notifier";

/**
 * Wires the channel notifier with the live MCP handle, kicks off the
 * community-identity prefetch, and starts the VK Long Poll loop. The loop
 * dispatches `message_new` events into `InboundService.handle` directly —
 * there is no HTTP edge for inbound. Stores are loaded earlier in `app.ts`
 * so they're ready when MCP tools run.
 */
export function startInbound(mcp: McpServer): void {
  container.resolve(CommunityResolver).prefetch();

  const service = container.resolve(InboundService);
  const notifier = new ChannelNotifier(mcp);
  service.setNotifier(notifier);
  startPermissionRelay(mcp, notifier);

  // Fire-and-forget — the service owns its own connect-backoff loop.
  void container.resolve(LongPollService).start();

  logger.info("inbound ready; long-poll starting");
}
