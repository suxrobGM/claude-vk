import { singleton } from "tsyringe";
import { StatusRegistry } from "@/common/status";
import { isMcpReady } from "@/mcp/server";
import { CommunityResolver } from "@/modules/access/community-resolver";
import { RecentSentMessages } from "@/modules/messaging/recent-sent";
import { stateDir } from "@/state/paths";
import type { ConfigResponse, StateResponse } from "./admin.schema";

/** Read-only admin queries: redacted config + runtime status snapshot. */
@singleton()
export class AdminService {
  constructor(
    private readonly status: StatusRegistry,
    private readonly recent: RecentSentMessages,
    private readonly community: CommunityResolver,
  ) {}

  /** Effective config with `vk_token` collapsed to "***" when set. */
  getConfig(): ConfigResponse {
    const identity = this.community.get();
    return {
      port: Number(process.env.PORT!),
      state_dir: stateDir,
      vk_community_id: identity?.id ?? null,
      vk_community_screen_name: identity?.screen_name ?? null,
      vk_token: process.env.VK_TOKEN ? "***" : null,
    };
  }

  /** Process-runtime snapshot, including MCP readiness. */
  getState(): StateResponse {
    return {
      runtime: { mcp_ready: isMcpReady(), ...this.status.get() },
      recent_messages_count: this.recent.size(),
    };
  }
}
