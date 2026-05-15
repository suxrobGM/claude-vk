import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { logger } from "@/common/logger";
import { CommunityResolver } from "@/modules/access/community-resolver";
import { startPermissionRelay } from "@/modules/permission-relay/permission-relay.startup";
import { InboundService } from "./inbound.service";
import { ChannelNotifier } from "./notifier";

/**
 * Wires the channel notifier with the live MCP handle and kicks off the
 * community-identity prefetch. The Elysia `inboundController` drives
 * `InboundService.handle` from incoming `POST /webhook/vk` requests. Stores
 * are loaded earlier in `app.ts` so they're ready when MCP tools run.
 */
export function startInbound(mcp: McpServer): void {
  container.resolve(CommunityResolver).prefetch();

  const service = container.resolve(InboundService);
  const notifier = new ChannelNotifier(mcp);
  service.setNotifier(notifier);
  startPermissionRelay(mcp, notifier);

  logger.info("inbound ready; webhook controller mounted");
}
