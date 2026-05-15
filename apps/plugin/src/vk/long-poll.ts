import { singleton } from "tsyringe";
import { VK } from "vk-io";
import { logger } from "@/common/logger";
import { StatusRegistry } from "@/common/status";
import { current as currentConfig } from "@/config";
import type { RawInbound } from "@/modules/inbound/router";

const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

type Handler = (raw: RawInbound) => Promise<void>;

/**
 * Long Poll loop wrapper. vk-io's `updates.start()` resolves once the loop
 * is running; transient transport errors are surfaced via the emitter and
 * vk-io retries on its own. We only need our own backoff for the *initial*
 * connect (token wrong, network down at boot, VK API outage).
 *
 * Auth errors (code 5) are fatal — no retry. The user has to fix the token.
 */
@singleton()
export class VkLongPoll {
  private vk: VK | null = null;
  private stopped = false;
  // Injectable for tests.
  private readonly sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms));

  constructor(private readonly status: StatusRegistry) {}

  /**
   * Begin polling and forward each `message_new` event to `onMessage`. Returns
   * once polling is running; transient errors are handled internally with
   * backoff. A missing token is a no-op (the HTTP layer stays alive).
   */
  async start(onMessage: Handler): Promise<void> {
    const cfg = currentConfig();
    if (!cfg.vkToken) {
      logger.warn("VK_TOKEN missing; long-poll will not start");
      this.status.markDisconnected("VK_TOKEN missing");
      return;
    }
    this.status.setTransport("longpoll");
    this.vk = new VK({ token: cfg.vkToken });
    this.vk.updates.on("message_new", async (ctx) => {
      this.status.markEvent();
      try {
        const raw = vkContextToRaw(ctx as unknown as VkMessageNewContext);
        await onMessage(raw);
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

        await this.sleep(delay);
        attempt++;
      }
    }
  }
}

interface VkMessageNewContext {
  peerId: number;
  senderId: number;
  conversationMessageId?: number | null;
  id?: number;
  text?: string | null;
  attachments?: VkContextAttachment[];
  replyMessage?: { conversationMessageId?: number | null; id?: number | null } | null;
}

interface VkContextAttachment {
  type: string;
  largeSizeUrl?: string;
  url?: string;
  oggUrl?: string;
}

export function vkContextToRaw(ctx: VkMessageNewContext): RawInbound {
  return {
    peer_id: ctx.peerId,
    from_id: ctx.senderId,
    conversation_message_id: ctx.conversationMessageId ?? undefined,
    message_id: ctx.id,
    text: ctx.text ?? undefined,
    attachments: (ctx.attachments ?? []).map((a) => ({
      type: a.type,
      url: a.largeSizeUrl ?? a.oggUrl ?? a.url,
    })),
    reply: ctx.replyMessage
      ? {
          conversation_message_id: ctx.replyMessage.conversationMessageId ?? undefined,
          message_id: ctx.replyMessage.id ?? undefined,
        }
      : undefined,
  };
}

function vkErrorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) {
    return null;
  }
  const c = (err as { code?: unknown }).code;
  return typeof c === "number" ? c : null;
}
