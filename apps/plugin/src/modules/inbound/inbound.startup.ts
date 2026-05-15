import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { AccessStore } from "@/modules/access/access.store";
import { UsersCache } from "@/modules/users/users.cache";
import { StateStore } from "@/state/state.store";
import { VkLongPoll } from "@/vk/long-poll";
import { InboundService } from "./inbound.service";
import { ChannelNotifier } from "./notifier";

/**
 * Boots stores, wires the channel notifier with the live MCP handle, and
 * starts the long-poll loop. Called once from `app.ts` after the MCP
 * stdio transport has connected.
 */
export async function startInbound(mcp: McpServer): Promise<void> {
  await container.resolve(StateStore).init();
  await container.resolve(AccessStore).init();
  await container.resolve(UsersCache).init();

  const service = container.resolve(InboundService);
  service.setNotifier(new ChannelNotifier(mcp));

  const longPoll = container.resolve(VkLongPoll);
  await longPoll.start((raw) => service.handle(raw));
}
