import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { logger } from "@/common/logger";
import { StatusRegistry } from "@/common/status";
import { current as currentConfig } from "@/config";
import { AccessStore } from "@/modules/access/access.store";
import { startPermissionRelay } from "@/modules/permission-relay/permission-relay.startup";
import { UsersCache } from "@/modules/users/users.cache";
import { StateStore } from "@/state/state.store";
import { VkLongPoll } from "@/vk/long-poll";
import { InboundService } from "./inbound.service";
import { ChannelNotifier } from "./notifier";

/**
 * Boots stores, wires the channel notifier with the live MCP handle, and
 * starts the inbound transport. Called once from `app.ts` after the MCP
 * stdio transport has connected. In `callback` mode no transport boots
 * here — the Elysia controller drives `InboundService.handle` directly.
 */
export async function startInbound(mcp: McpServer): Promise<void> {
  await container.resolve(StateStore).init();
  await container.resolve(AccessStore).init();
  await container.resolve(UsersCache).init();

  const service = container.resolve(InboundService);
  const notifier = new ChannelNotifier(mcp);
  service.setNotifier(notifier);
  startPermissionRelay(mcp, notifier);

  if (currentConfig().transport === "callback") {
    container.resolve(StatusRegistry).setTransport("callback");
    logger.info("transport=callback; long-poll skipped, webhook controller mounted by app.ts");
    return;
  }

  const longPoll = container.resolve(VkLongPoll);
  await longPoll.start((raw) => service.handle(raw));
}
