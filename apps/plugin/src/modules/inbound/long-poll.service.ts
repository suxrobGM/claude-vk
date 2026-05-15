import { singleton } from "tsyringe";
import { VK } from "vk-io";
import { logger } from "@/common/logger";
import { StatusRegistry } from "@/common/status";
import { current as currentConfig } from "@/config";
import { InboundService } from "./inbound.service";
import { vkMessageToInbound, type VkMessage } from "./message-adapter";

const VK_API_VERSION = "5.199";
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * VK community Long Poll loop. Wraps `vk-io`'s `updates.start()` — which
 * auto-resolves the bound group ID via `groups.getById` and handles the poll
 * cursor (`ts`), retries, and key-expired refresh on its own. We only own:
 *
 * - the initial-connect backoff (token wrong / network down at boot),
 * - the `message_new` handler that dispatches into `InboundService.handle`,
 * - the `StatusRegistry` updates so `/admin/state` reflects reality.
 *
 * Auth errors (VK code 5) are fatal — no retry. The user must fix the token.
 * Missing `VK_TOKEN` is a no-op (HTTP layer + `/healthz` stay alive).
 */
@singleton()
export class LongPollService {
  private vk: VK | null = null;
  private stopped = false;

  constructor(
    private readonly inbound: InboundService,
    private readonly status: StatusRegistry,
  ) {}

  /** Begin polling. Returns once the loop is running (or has given up on auth). */
  async start(): Promise<void> {
    const cfg = currentConfig();
    if (!cfg.vkToken) {
      logger.warn("VK_TOKEN missing; long-poll will not start");
      this.status.markDisconnected("VK_TOKEN missing");
      return;
    }

    this.vk = new VK({ token: cfg.vkToken, apiVersion: VK_API_VERSION });
    this.vk.updates.on("message_new", async (ctx) => {
      this.status.markEvent();
      try {
        // `payload` is typed as `protected` on `vk-io`'s `Context` base but is
        // a normal public field at runtime — the camelCase getters mirror the
        // same data and we'd just have to re-translate them. Cast through
        // unknown so we keep using the snake_case shape that `vk-io` itself
        // assembled from the long-poll response.
        const raw = (ctx as unknown as { payload?: { message?: VkMessage } }).payload?.message;
        await this.inbound.handle(vkMessageToInbound(raw));
      } catch (err) {
        logger.error({ err }, "long-poll handler threw");
      }
    });

    await this.startWithBackoff();
  }

  /** Stop the polling loop. Used by tests and shutdown handlers. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.vk) {
      try {
        await this.vk.updates.stop();
      } catch (err) {
        logger.warn({ err }, "vk-io updates.stop failed");
      }
    }
  }

  private async startWithBackoff(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.vk!.updates.start();
        this.status.markConnected();
        logger.info("vk long-poll started");
        return;
      } catch (err) {
        const code = vkErrorCode(err);
        if (code === 5) {
          logger.error({ err }, "vk auth error (code 5) — token invalid; aborting long-poll");
          this.status.markDisconnected("vk_api_5: token invalid");
          return;
        }

        const delay = BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)]!;
        logger.warn({ attempt, delay, err }, "long-poll start failed; backing off");
        this.status.markDisconnected(`start failed (attempt ${attempt + 1})`);
        await sleep(delay);
        attempt++;
      }
    }
  }
}

function vkErrorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const c = (err as { code?: unknown }).code;
  return typeof c === "number" ? c : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
