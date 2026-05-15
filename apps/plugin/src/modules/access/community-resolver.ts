import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { VkClient } from "@/vk/client";

export interface CommunityIdentity {
  id: string;
  screen_name: string | undefined;
}

/**
 * Resolves the bound community's `id` + `screen_name` once via `groups.getById`
 * and caches the result. `MentionDetector` reads the snapshot synchronously;
 * `prefetch()` is called from `startInbound` so the value is usually ready
 * before the first inbound event arrives.
 */
@singleton()
export class CommunityResolver {
  private identity: CommunityIdentity | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly vk: VkClient) {}

  /** Synchronous snapshot. Returns null until first resolution succeeds. */
  get(): CommunityIdentity | null {
    return this.identity;
  }

  /** Kick off resolution. Idempotent — no-ops once resolved or in-flight. */
  prefetch(): void {
    if (this.identity || this.inflight) return;
    this.inflight = (async () => {
      try {
        const self = await this.vk.groupsGetSelf();
        this.identity = { id: String(self.id), screen_name: self.screen_name };
        logger.info(
          { id: this.identity.id, screen_name: this.identity.screen_name },
          "community identity resolved from groups.getById",
        );
      } catch (err) {
        logger.warn({ err }, "groups.getById failed; mention detection disabled");
      } finally {
        this.inflight = null;
      }
    })();
  }
}
