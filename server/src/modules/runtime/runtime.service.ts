import { singleton } from "tsyringe";
import { StatusRegistry } from "@/common/status";
import { isMcpReady } from "@/mcp/server";
import { CommunityResolver } from "@/modules/access/community-resolver";
import { RecentSentMessages } from "@/modules/messaging/recent-sent";
import type { ConfigResponse, StateResponse } from "./runtime.schema";

/** Read-only runtime queries: redacted config + runtime status snapshot. */
@singleton()
export class RuntimeService {
  constructor(
    private readonly status: StatusRegistry,
    private readonly recent: RecentSentMessages,
    private readonly community: CommunityResolver,
  ) {}

  /** Effective config with `vkToken` collapsed to "***" when set. */
  getConfig(): ConfigResponse {
    const identity = this.community.get();
    return {
      port: Number(process.env.PORT!),
      vkCommunityId: identity?.id ?? null,
      vkCommunityScreenName: identity?.screenName ?? null,
      vkToken: process.env.VK_TOKEN ? "***" : null,
    };
  }

  /** Process-runtime snapshot, including MCP readiness. */
  getState(): StateResponse {
    return {
      runtime: { mcpReady: isMcpReady(), ...this.status.get() },
      recentMessagesCount: this.recent.size(),
    };
  }
}
