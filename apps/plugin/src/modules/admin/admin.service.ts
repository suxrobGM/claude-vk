import { singleton } from "tsyringe";
import { StatusRegistry } from "@/common/status";
import { current as currentConfig } from "@/config";
import { isMcpReady } from "@/mcp/server";
import { StateStore } from "@/state/state.store";
import type { ConfigResponse, StateResponse } from "./admin.schema";

/** Read-only admin queries: redacted config + merged runtime/persisted state. */
@singleton()
export class AdminService {
  constructor(
    private readonly status: StatusRegistry,
    private readonly stateStore: StateStore,
  ) {}

  /** Effective config with `vk_token`/`webhook_secret` collapsed to "***" when set. */
  getConfig(): ConfigResponse {
    const c = currentConfig();
    return {
      port: c.port,
      http_bind: c.httpBind,
      transport: c.transport,
      locale: c.locale,
      permission_relay: c.permissionRelay,
      state_dir: c.stateDir ?? null,
      vk_community_id: c.vkCommunityId ?? null,
      vk_community_screen_name: c.vkCommunityScreenName ?? null,
      vk_token: c.vkToken ? "***" : null,
      webhook_secret: c.webhookSecret ? "***" : null,
    };
  }

  /** Process-runtime snapshot, including MCP readiness and the long-poll cursor. */
  getState(): StateResponse {
    return {
      runtime: { mcp_ready: isMcpReady(), ...this.status.get() },
      longpoll: this.stateStore.getLongpoll() ?? null,
      recent_messages_count: this.stateStore.getRecentMessages().length,
    };
  }
}
