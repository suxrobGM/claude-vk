import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { logger } from "@/common/logger";
import { CommunityResolver } from "@/modules/access/community-resolver";
import { startPermissionRelay } from "@/modules/permission-relay/permission-relay.startup";
import { InboundService } from "./inbound.service";
import { LongPollService } from "./long-poll.service";
import { ChannelNotifier } from "./notifier";

/**
 * Wires the live MCP notifier into inbound + permission-relay + long-poll,
 * prefetches the community identity, then starts the long-poll loop.
 */
export function startInbound(mcp: McpServer): void {
  container.resolve(CommunityResolver).prefetch();

  const service = container.resolve(InboundService);
  const notifier = new ChannelNotifier(mcp);
  service.setNotifier(notifier);
  startPermissionRelay(mcp, notifier);

  const longPoll = container.resolve(LongPollService);
  longPoll.setNotifier(notifier);

  // Fire-and-forget — the service owns its own connect-backoff loop.
  void longPoll.start();

  logger.info("inbound ready; long-poll starting");
}
