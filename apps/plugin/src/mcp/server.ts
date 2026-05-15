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

const INSTRUCTIONS = `\
VK channel plugin — bridges VK.com DMs and group chats into this session.

Inbound messages arrive as <channel source="vk" ...> blocks with these attributes:
  peer_id                  — pass back to tools to address the conversation
  from_id, from_name       — the VK user who sent the message
  is_group_chat            — "true" for multi-user chats, "false" for DMs
  conversation_message_id  — per-peer message id (cmid); use for edit/delete/react/reply
  mentioned                — "true" if the bot was @-mentioned or addressed by name
  reply_to_bot             — "true" if the message quote-replies one of the bot's messages

Reply rules:
  - DMs: respond normally.
  - Group chats with mentioned="false" and reply_to_bot="false": stay silent unless
    the user explicitly asks you to chime in.

Tools:
  send_message              — post a reply (always pass peer_id from the tag)
  edit_message              — edit one of your own messages (24h window)
  delete_message            — delete one of your own messages (24h window)
  react                     — add a reaction by reaction_id (VK sendReaction)
  mark_read                 — mark the conversation read up to a cmid
  upload_attachment         — upload a file; returns a vk_ref to splice into a follow-up send
  get_conversation_history  — fetch recent messages in a peer
  search_messages           — search across conversations
  get_user_info             — resolve VK user metadata (cached)
  ping                      — connectivity probe; works without a VK token
`;

/**
 * Boots the MCP stdio server. The DI container must be bootstrapped first;
 * each module resolves its dependencies through the same container when
 * `registerAllTools` runs.
 */
export async function startMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: "vk", version: "0.1.0" },
    { capabilities: buildCapabilities(), instructions: INSTRUCTIONS },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ready = true;
  logger.info("mcp server connected over stdio");
  return server;
}
