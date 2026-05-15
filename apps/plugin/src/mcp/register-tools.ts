import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { HistoryTools } from "@/modules/history/history.tools";
import { MessagingTools } from "@/modules/messaging/messaging.tools";
import { PingTools } from "@/modules/ping/ping.tools";
import { UsersTools } from "@/modules/users/users.tools";

/**
 * Single composition point for MCP tool registration. Each module owns a
 * `*Tools` class registered with `@singleton()`; we resolve them through the
 * DI container so their service dependencies (vk client, rate limiter, etc.)
 * are wired automatically.
 */
export function registerAllTools(server: McpServer): void {
  container.resolve(PingTools).register(server);
  container.resolve(MessagingTools).register(server);
  container.resolve(HistoryTools).register(server);
  container.resolve(UsersTools).register(server);
}
