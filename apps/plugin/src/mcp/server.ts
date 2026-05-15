import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "@/common/logger";
import { buildCapabilities } from "./capabilities";
import { registerAllTools } from "./register-tools";

let ready = false;

/** True once the MCP stdio transport has connected. */
export function isMcpReady(): boolean {
  return ready;
}

/** Back-compat alias. */
export const isReady = isMcpReady;

/**
 * Boots the MCP stdio server. The DI container must be bootstrapped first;
 * each module resolves its dependencies through the same container when
 * `registerAllTools` runs.
 */
export async function startMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: "vk", version: "0.1.0" },
    {
      capabilities: buildCapabilities(),
      instructions:
        'VK channel plugin. Messages arrive as <channel source="vk" peer_id="…" ' +
        'from_id="…" from_name="…" is_group_chat="…" conversation_message_id="…" ' +
        'mentioned="…"> blocks. Reply with the send_message tool, passing peer_id ' +
        "from the tag. Use edit_message / delete_message for prior messages " +
        '(24h window, own messages only). In group chats with mentioned="false", ' +
        "do not reply unless the user explicitly asks you to. Use the `ping` " +
        "tool to verify connectivity without a token.",
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ready = true;
  logger.info("mcp server connected over stdio");
  return server;
}
