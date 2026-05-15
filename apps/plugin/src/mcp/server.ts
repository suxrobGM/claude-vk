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
        'mentioned="…" reply_to_bot="…"> blocks. Reply with `send_message`, ' +
        'passing peer_id from the tag. In group chats with mentioned="false", ' +
        "do not reply unless the user explicitly asks you to. " +
        "Tools: `send_message`, `edit_message`, `delete_message` (own messages, " +
        "24h window), `react` (sendReaction by reaction_id), `mark_read`, " +
        "`upload_attachment` (returns a `vk_ref` you splice into a follow-up send), " +
        "`get_conversation_history` and `search_messages` (the VK-vs-Telegram " +
        "differentiator — Telegram can't do these), `get_user_info` (cached), " +
        "`ping` (connectivity probe, no token needed).",
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ready = true;
  logger.info("mcp server connected over stdio");
  return server;
}
