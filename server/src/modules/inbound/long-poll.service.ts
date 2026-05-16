import { singleton } from "tsyringe";
import { VK } from "vk-io";
import { logger } from "@/common/logger";
import { StatusRegistry } from "@/common/status";
import { sleep } from "@/common/utils";
import { InboundService } from "./inbound.service";
import { vkMessageToInbound, type VkMessage } from "./message-adapter";
import type { ChannelNotifier } from "./notifier";

const VK_API_VERSION = "5.199";
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const SUSTAINED_BACKOFF_ATTEMPTS = 3;

/**
 * Wraps `vk-io`'s `updates.start()` with a connect-backoff loop, a
 * `message_new` dispatcher, status reporting, and channel warnings for fatal
 * failures (VK code 5, missing token, sustained backoff).
 */
@singleton()
export class LongPollService {
  private vk: VK | null = null;
  private stopped = false;
  private notifier: ChannelNotifier | null = null;
  private sustainedWarningSent = false;

  constructor(
    private readonly inbound: InboundService,
    private readonly status: StatusRegistry,
  ) {}

  /** Wires the live channel notifier; called once from `inbound.startup`. */
  setNotifier(notifier: ChannelNotifier): void {
    this.notifier = notifier;
  }

  /** Begin polling. Returns once the loop is running (or has given up on auth). */
  async start(): Promise<void> {
    const token = process.env.VK_TOKEN;
    if (!token) {
      logger.warn("VK_TOKEN missing; long-poll will not start");
      this.status.markDisconnected("VK_TOKEN missing");
      void this.warn(
        "VK_TOKEN is not configured. Run `/vk:configure <token>` and restart this Claude session to connect VK.",
      );
      return;
    }

    this.vk = new VK({ token, apiVersion: VK_API_VERSION });

    this.vk.updates.on("message_new", async (ctx) => {
      this.status.markEvent();
      try {
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
        this.sustainedWarningSent = false;
        logger.info("vk long-poll started");
        return;
      } catch (err) {
        const code = vkErrorCode(err);
        if (code === 5) {
          logger.error({ err }, "vk auth error (code 5) — token invalid; aborting long-poll");
          this.status.markDisconnected("vk_api_5: token invalid");
          void this.warn(
            "VK rejected the access token (error 5). Generate a new community token at vk.com → Manage → API usage → Access tokens, then run `/vk:configure <new-token>` and restart this Claude session.",
          );
          return;
        }

        const delay = BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)]!;
        logger.warn({ attempt, delay, err }, "long-poll start failed; backing off");
        this.status.markDisconnected(`start failed (attempt ${attempt + 1})`);

        if (attempt + 1 === SUSTAINED_BACKOFF_ATTEMPTS && !this.sustainedWarningSent) {
          this.sustainedWarningSent = true;
          void this.warn(
            "VK Long Poll has not connected after 3 attempts. Verify Long Poll API is enabled in the community admin (Manage → API usage → Long Poll API, version ≥ 5.199, `message_new` checked) and that the host has outbound HTTPS access.",
          );
        }

        await sleep(delay);
        attempt++;
      }
    }
  }

  private async warn(message: string): Promise<void> {
    const notifier = this.notifier;
    if (!notifier) {
      return;
    }

    try {
      await notifier.warn(message);
    } catch (err) {
      logger.warn({ err }, "long-poll channel warning failed");
    }
  }
}

function vkErrorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) {
    return null;
  }
  const c = (err as { code?: unknown }).code;
  return typeof c === "number" ? c : null;
}
