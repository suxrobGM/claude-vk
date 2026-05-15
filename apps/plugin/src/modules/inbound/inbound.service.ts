import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { AccessGate } from "@/modules/access/access.gate";
import { PairingService } from "@/modules/access/pairing";
import { UsersCache } from "@/modules/users/users.cache";
import { AttachmentService } from "./attachments";
import type { ChannelNotifier } from "./notifier";
import { normalize, type RawInbound } from "./router";

/**
 * Inbound pipeline: normalize → gate → (pair | download + notify).
 * Every branch swallows exceptions so the long-poll loop is never interrupted
 * by a single bad message. The notifier is injected from `app.ts` at boot
 * (it carries the live `McpServer` handle) rather than via the container.
 */
@singleton()
export class InboundService {
  private notifier: ChannelNotifier | null = null;

  constructor(
    private readonly gate: AccessGate,
    private readonly pairing: PairingService,
    private readonly attachments: AttachmentService,
    private readonly users: UsersCache,
  ) {}

  /** Wires the live channel notifier; called once from `inbound.startup`. */
  setNotifier(notifier: ChannelNotifier): void {
    this.notifier = notifier;
  }

  /** Run the inbound pipeline for a single raw VK update. Never throws. */
  async handle(raw: RawInbound): Promise<void> {
    try {
      const msg = normalize(raw);
      const verdict = this.gate.check(msg);
      if (verdict.kind === "drop") {
        logger.debug(
          { peer_id: msg.peer_id, from_id: msg.from_id, reason: verdict.reason },
          "inbound dropped",
        );
        return;
      }
      if (verdict.kind === "need_pair") {
        await this.pairing.emitCode(msg);
        return;
      }

      const withFiles = await this.attachments.downloadAll(
        msg.attachments,
        msg.peer_id,
        msg.conversation_message_id,
      );
      const name = await this.users.resolve(msg.from_id);
      const notifier = this.notifier;
      if (!notifier) {
        logger.error("inbound notifier missing; dropping message");
        return;
      }
      await notifier.notify({ ...msg, attachments: withFiles }, name);
    } catch (err) {
      logger.error({ err }, "inbound handler crashed; transport continues");
    }
  }
}
