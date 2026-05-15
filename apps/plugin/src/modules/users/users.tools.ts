import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { singleton } from "tsyringe";
import { runWithEnvelope, toCallResult } from "@/common/utils/tool-envelope";
import { UsersCache } from "./users.cache";
import {
  GetUserInfoInputShape,
  type GetUserInfoInput,
  type GetUserInfoResult,
  type UserEntry,
} from "./users.schema";

/** MCP adapter for `get_user_info`. Goes through `UsersCache` so peers.json warms. */
@singleton()
export class UsersTools {
  constructor(private readonly cache: UsersCache) {}

  register(server: McpServer): void {
    server.registerTool(
      "get_user_info",
      {
        description:
          "Resolve VK user IDs to display name, screen name, and photo URL. " +
          "Backed by `peers.json` cache (1h TTL). Unknown ids are silently dropped — " +
          "caller can detect by length diff vs. input.",
        inputSchema: GetUserInfoInputShape,
      },
      async (args: GetUserInfoInput) => toCallResult(await this.lookup(args)),
    );
  }

  private async lookup(input: GetUserInfoInput): Promise<GetUserInfoResult> {
    return runWithEnvelope("get_user_info", async () => {
      const resolved: UserEntry[] = [];
      for (const id of input.user_ids) {
        const entry = await this.cache.getFull(id);
        if (entry) resolved.push(entry);
      }
      return { ok: true, users: resolved } as const;
    });
  }
}
