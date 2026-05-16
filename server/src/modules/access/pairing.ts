import { randomInt } from "node:crypto";
import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { MessagingService } from "@/modules/messaging/messaging.service";
import { AccessStore } from "./access.store";
import type { ChatEntry, PendingPair } from "./schemas/access-file.schema";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 32 chars, no 0/O/1/I/L
const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function pairingMessage(code: string): string {
  return `Hi! I'm a Claude Code assistant. To connect this chat, the operator runs:\n\n    /vk:access pair ${code}\n\n…in their Claude session. The code expires in 10 minutes.`;
}

export type ConsumeResult =
  | { ok: true; peerId: number; chat: ChatEntry }
  | { ok: false; reason: "unknown" | "expired" };

/**
 * DM-only pairing: emits a 6-char code to unknown DMs and consumes it via
 * the admin API. Codes survive restarts (stored in `access.json`) and are
 * swept on every consume(). Group chats use `/vk:access group add` instead.
 */
@singleton()
export class PairingService {
  constructor(
    private readonly access: AccessStore,
    private readonly messaging: MessagingService,
  ) {}

  /** Generates a code, writes it to pendingPairs, and DMs the originating peer. */
  async emitCode(msg: InboundMessage): Promise<void> {
    if (msg.is_group_chat) {
      logger.warn(
        { peer_id: msg.peer_id },
        "pairing.emitCode called for a group chat — ignored (groups use explicit add)",
      );
      return;
    }

    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);

    await this.access.update((draft) => {
      sweepExpired(draft.pendingPairs, now);
      draft.pendingPairs[code] = {
        peerId: msg.peer_id,
        fromId: msg.from_id,
        expiresAt: expiresAt.toISOString(),
      };
    });

    const text = pairingMessage(code);
    const result = await this.messaging.send({ peer_id: msg.peer_id, text });
    if (!result.ok) {
      logger.warn(
        { peer_id: msg.peer_id, code, err: result.code, msg: result.message },
        "failed to send pairing code DM",
      );
      return;
    }
    logger.info({ peer_id: msg.peer_id, code }, "pairing code emitted");
  }

  /** Atomic consume: validate, sweep expired, install DM chat, clear pending entry. */
  async consume(code: string): Promise<ConsumeResult> {
    let outcome: ConsumeResult = { ok: false, reason: "unknown" };
    await this.access.update((draft) => {
      const now = new Date();
      sweepExpired(draft.pendingPairs, now);

      const pending = draft.pendingPairs[code];
      if (!pending) {
        outcome = { ok: false, reason: "unknown" };
        return;
      }

      // A DM has exactly one possible sender (peer_id === from_id), so no senders[] is needed.
      const entry: ChatEntry = {
        kind: "dm",
        addedAt: now.toISOString(),
        addedBy: "pairing",
      };
      draft.chats[String(pending.peerId)] = entry;
      delete draft.pendingPairs[code];
      outcome = { ok: true, peerId: pending.peerId, chat: entry };
    });
    return outcome;
  }

  listPending(): { code: string; pair: PendingPair }[] {
    const file = this.access.get();
    return Object.entries(file.pendingPairs).map(([code, pair]) => ({ code, pair }));
  }

  /** Drops any pending pair codes whose TTL has already elapsed. Run on boot. */
  async pruneExpired(): Promise<void> {
    const now = new Date();
    const before = Object.keys(this.access.get().pendingPairs).length;
    if (before === 0) {
      return;
    }
    let removed = 0;

    await this.access.update((draft) => {
      const sizeBefore = Object.keys(draft.pendingPairs).length;
      sweepExpired(draft.pendingPairs, now);
      removed = sizeBefore - Object.keys(draft.pendingPairs).length;
    });

    if (removed > 0) logger.info({ removed }, "pruned expired pairing codes on startup");
  }
}

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

function sweepExpired(pairs: Record<string, PendingPair>, now: Date): void {
  for (const [code, pair] of Object.entries(pairs)) {
    if (Date.parse(pair.expiresAt) <= now.getTime()) {
      delete pairs[code];
    }
  }
}
