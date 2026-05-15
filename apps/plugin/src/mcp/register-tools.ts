import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { container } from "@/common/di";
import { MessagingTools } from "@/modules/messaging";
import { PingTools } from "@/modules/ping";

/**
 * Single composition point for MCP tool registration. Each module owns a
 * `*Tools` class registered with `@injectable()`; we resolve them through the
 * DI container so their service dependencies (vk client, rate limiter, etc.)
 * are wired automatically.
 */
export function registerAllTools(server: McpServer): void {
  container.resolve(PingTools).register(server);
  container.resolve(MessagingTools).register(server);
}
