import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { logger } from "@/common/logger";
import { current as currentConfig } from "@/config";
import type { ChannelNotifier } from "@/modules/inbound/notifier";
import { PermissionRequestNotificationSchema } from "./permission-relay.schema";
import { PermissionRelayService } from "./permission-relay.service";

/**
 * Wires the live MCP handle into `PermissionRelayService` and registers the
 * `notifications/claude/channel/permission_request` listener. No-op when
 * `VK_PERMISSION_RELAY=false`. Called once from `startInbound` after the
 * notifier is constructed so we can share the same `ChannelNotifier` instance.
 */
export function startPermissionRelay(mcp: McpServer, notifier: ChannelNotifier): void {
  if (!currentConfig().permissionRelay) return;

  const service = container.resolve(PermissionRelayService);
  service.setMcp(mcp);
  service.setNotifier(notifier);

  mcp.server.setNotificationHandler(PermissionRequestNotificationSchema, async (notification) => {
    try {
      await service.handleRequest(notification.params);
    } catch (err) {
      logger.error({ err }, "permission relay: handleRequest threw");
    }
  });

  logger.info("permission relay enabled; listening for permission_request notifications");
}
