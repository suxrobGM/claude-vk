import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { singleton } from "tsyringe";

/**
 * Smoke-test tool with no VK dependency. Useful for verifying the channel is
 * connected without requiring `VK_TOKEN` to be set.
 */
@singleton()
export class PingTools {
  register(server: McpServer): void {
    server.registerTool(
      "ping",
      {
        description: "Smoke-test tool. Returns 'pong'. Verifies channel connectivity.",
        inputSchema: {},
      },
      () => ({
        content: [{ type: "text", text: "pong" }],
      }),
    );
  }
}
