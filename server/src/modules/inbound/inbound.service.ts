import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { AccessGate } from "@/modules/access/access.gate";
import { MentionDetector } from "@/modules/access/mention";
import { PairingService } from "@/modules/access/pairing";
import { PendingGroupsRegistry } from "@/modules/access/pending-groups";
import { MessagingService } from "@/modules/messaging/messaging.service";
import { PermissionRelayService } from "@/modules/permission-relay/permission-relay.service";
import { UsersCache } from "@/modules/users/users.cache";
import { AttachmentService } from "./attachments";
import type { InboundMessage } from "./inbound.types";
import type { ChannelNotifier } from "./notifier";

const DENY_REPLY_TTL_MS = 24 * 60 * 60 * 1000;
const DENY_REPLY_TEXT =
  "This bot is locked to specific users. Ask the operator to add you to the allowlist.";

/**
 * Inbound pipeline: gate → (pair | download + notify). Every branch swallows
 * exceptions so the long-poll loop keeps running. The notifier is injected
 * from `app.ts` at boot (it carries the live `McpServer` handle) rather than
 * via the container.
 */
@singleton()
export class InboundService {
  private notifier: ChannelNotifier | null = null;
  private readonly denyReplies = new Map<string, number>();

  constructor(
    private readonly gate: AccessGate,
    private readonly pairing: PairingService,
    private readonly attachments: AttachmentService,
    private readonly users: UsersCache,
    private readonly mentions: MentionDetector,
    private readonly permissionRelay: PermissionRelayService,
    private readonly messaging: MessagingService,
    private readonly pendingGroups: PendingGroupsRegistry,
  ) {}

  /** Wires the live channel notifier; called once from `inbound.startup`. */
  setNotifier(notifier: ChannelNotifier): void {
    this.notifier = notifier;
  }

  /** Run the inbound pipeline for a single normalized VK message. Never throws. */
  async handle(msg: InboundMessage): Promise<void> {
    try {
      logger.debug(
        {
          peer_id: msg.peer_id,
          from_id: msg.from_id,
          is_group_chat: msg.is_group_chat,
          text: msg.text,
          attachments: msg.attachments.length,
        },
        "inbound message received",
      );

      const signals = this.mentions.detect(msg);
      msg.mentioned_bot = signals.name_mention || signals.reply_to_bot || signals.keyboard_payload;
      msg.is_reply_to_bot = signals.reply_to_bot;

      const verdict = this.gate.check(msg);
      if (verdict.kind === "drop") {
        if (msg.is_group_chat && verdict.reason === "chat-not-allowed") {
          this.pendingGroups.record({
            peer_id: msg.peer_id,
            from_id: msg.from_id,
            text: msg.text,
          });
        }
        logger.info(
          { peer_id: msg.peer_id, from_id: msg.from_id, reason: verdict.reason },
          "inbound dropped",
        );
        return;
      }
      if (verdict.kind === "deny_with_reply") {
        await this.sendDenyReply(msg, verdict.reason);
        return;
      }
      if (verdict.kind === "need_pair") {
        // Only DMs ever reach `need_pair`; groups are opt-in via `/vk:access group add`.
        await this.pairing.emitCode(msg);
        return;
      }

      // Verdict short-circuit: AFTER gate (so we trust from_id), BEFORE notify
      // (so verdict text never becomes a <channel> block for Claude — PRD §15.1).
      if (await this.permissionRelay.tryResolveVerdict(msg)) return;

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
      logger.info(
        {
          peer_id: msg.peer_id,
          from_id: msg.from_id,
          mentioned: msg.mentioned_bot,
          reply_to_bot: msg.is_reply_to_bot,
        },
        "channel notification emitted",
      );

      // Record the DM activator so an incoming permission_request knows where
      // to send the prompt. Group chats are explicitly excluded by PRD §15.2.
      if (!msg.is_group_chat) {
        this.permissionRelay.recordLastDmActivator(msg.peer_id, msg.from_id);
      }
    } catch (err) {
      logger.error({ err }, "inbound handler crashed; transport continues");
    }
  }

  /**
   * One-time "you're not on the allowlist" reply per (peer, sender) within a
   * 24h window — so a denied sender hears back once but a repeat-offender
   * doesn't get spammed. Group chats never reach this path (verdict.drop
   * instead) because a reply there would be noisy.
   */
  private async sendDenyReply(msg: InboundMessage, reason: string): Promise<void> {
    const key = `${String(msg.peer_id)}:${String(msg.from_id)}`;
    const now = Date.now();
    const last = this.denyReplies.get(key);

    if (last != null && now - last < DENY_REPLY_TTL_MS) {
      logger.debug({ peer_id: msg.peer_id, from_id: msg.from_id, reason }, "deny reply suppressed");
      return;
    }

    this.denyReplies.set(key, now);
    const result = await this.messaging.send({ peer_id: msg.peer_id, text: DENY_REPLY_TEXT });

    if (!result.ok) {
      logger.warn(
        { peer_id: msg.peer_id, err: result.code, msg: result.message },
        "failed to send deny reply",
      );
    }
  }
}
