import type { McpServer } from "@modelcontextprotocol/server";
import { container } from "@/common/di";
import { logger } from "@/common/logger";
import type { ChannelNotifier } from "@/modules/inbound/notifier";
import {
  PERMISSION_REQUEST_METHOD,
  PermissionRequestParamsSchema,
} from "./permission-relay.schema";
import { PermissionRelayService } from "./permission-relay.service";

/**
 * Wires the live MCP handle into `PermissionRelayService` and registers the
 * `notifications/claude/channel/permission_request` listener. Called once from
 * `startInbound` after the notifier is constructed so we can share the same
 * `ChannelNotifier` instance.
 */
export function startPermissionRelay(mcp: McpServer, notifier: ChannelNotifier): void {
  const service = container.resolve(PermissionRelayService);
  service.setMcp(mcp);
  service.setNotifier(notifier);

  mcp.server.setNotificationHandler(
    PERMISSION_REQUEST_METHOD,
    { params: PermissionRequestParamsSchema },
    async (params) => {
      try {
        await service.handleRequest(params);
      } catch (err) {
        logger.error({ err }, "permission relay: handleRequest threw");
      }
    },
  );

  logger.info("permission relay listening for permission_request notifications");
}
