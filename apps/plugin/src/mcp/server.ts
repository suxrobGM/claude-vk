import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "@/common/logger";
import { buildCapabilities } from "./capabilities";
import { registerAllTools } from "./register-tools";

let ready = false;

export function isReady(): boolean {
  return ready;
}

/**
 * Boots the MCP stdio server. The DI container must be bootstrapped (see
 * `bootstrapContainer`) before this runs — every module's `register()` resolves
 * its dependencies through the same container.
 */
export async function startMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: "vk", version: "0.1.0" },
    {
      capabilities: buildCapabilities(),
      instructions:
        "VK channel plugin. Outbound tools (send_message, edit_message, " +
        "delete_message) are available now. Inbound <channel> events from VK " +
        "land in M2. Use the `ping` tool to verify connectivity without a token.",
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ready = true;
  logger.info("mcp server connected over stdio");
  return server;
}
