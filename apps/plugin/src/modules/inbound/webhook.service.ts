import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { StatusRegistry } from "@/common/status";
import { current as currentConfig } from "@/config";
import { EventIdDedup } from "./event-dedup";
import { InboundService } from "./inbound.service";
import { webhookMessageNewToInbound, type VkCallbackMessageNewObject } from "./webhook-adapter";
import type { WebhookEnvelope } from "./webhook.schema";

/**
 * VK Callback API event dispatcher. PRD §9.2 invariant: every path resolves to
 * a 2xx body — VK marks the endpoint unhealthy on any non-2xx, including
 * secret mismatches and malformed payloads. Real errors are logged, not
 * surfaced over HTTP. The Elysia controller is a one-line wrapper around
 * {@link handle}.
 */
@singleton()
export class WebhookService {
  private warnedMissingEventId = false;

  constructor(
    private readonly inbound: InboundService,
    private readonly dedup: EventIdDedup,
    private readonly status: StatusRegistry,
  ) {}

  /** Process one webhook envelope. Always returns a 2xx response body string. */
  async handle(body: WebhookEnvelope): Promise<string> {
    const cfg = currentConfig();

    if (cfg.webhookSecret && body.secret !== cfg.webhookSecret) {
      logger.warn({ type: body.type }, "webhook secret mismatch; ignoring");
      return "ok";
    }

    if (body.type === "confirmation") {
      this.status.markConnected();
      return cfg.webhookConfirmation ?? "ok";
    }

    if (body.type === "message_new") {
      if (body.event_id) {
        const isNew = this.dedup.add(body.event_id);
        if (!isNew) {
          logger.debug({ event_id: body.event_id }, "duplicate webhook event_id; ignoring");
          return "ok";
        }
      } else if (!this.warnedMissingEventId) {
        this.warnedMissingEventId = true;
        logger.warn("webhook message_new without event_id; dedup disabled for this event");
      }

      if (!isMessageNewObject(body.object)) {
        logger.warn({ body }, "webhook message_new with malformed object; ignoring");
        return "ok";
      }

      this.status.markConnected();
      this.status.markEvent();
      void this.inbound.handle(webhookMessageNewToInbound(body.object)).catch((err) => {
        logger.error({ err }, "inbound.handle threw from webhook (should never happen)");
      });
      return "ok";
    }

    logger.debug({ type: body.type }, "unhandled webhook event type");
    return "ok";
  }
}

function isMessageNewObject(o: unknown): o is VkCallbackMessageNewObject {
  return typeof o === "object" && o !== null && "message" in o;
}
