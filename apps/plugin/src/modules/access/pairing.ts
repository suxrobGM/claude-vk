import { randomInt } from "node:crypto";
import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { MessagingService } from "@/modules/messaging/messaging.service";
import type { ChatEntry, ChatKind, PendingPair } from "./access.schema";
import { AccessStore } from "./access.store";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 32 chars, no 0/O/1/I/L
const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;

function pairingMessage(code: string, kind: ChatKind): string {
  const base = `Hi! I'm a Claude Code assistant. To connect this chat, the operator runs:\n\n    /vk:access pair ${code}\n\n…in their Claude session. The code expires in 10 minutes.`;
  if (kind === "group_chat") {
    return `${base}\n\nThis is a group chat: mention me with \`@<community> <message>\` or reply to one of my messages to talk to me afterwards.`;
  }
  return base;
}

export type ConsumeResult =
  | { ok: true; peer_id: number; chat: ChatEntry }
  | { ok: false; reason: "unknown" | "expired" };

/**
 * Generates pairing codes, sends them as DMs, and consumes them atomically.
 * The code lives in `access.json → pending_pairs` so a process restart
 * doesn't invalidate an in-flight pairing; expired entries are swept on
 * every consume() so the file doesn't grow unbounded.
 */
@singleton()
export class PairingService {
  constructor(
    private readonly access: AccessStore,
    private readonly messaging: MessagingService,
  ) {}

  /** Generates a code, writes it to pending_pairs, and DMs the originating peer. */
  async emitCode(msg: InboundMessage): Promise<void> {
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);
    const kind: ChatKind = msg.is_group_chat ? "group_chat" : "dm";

    await this.access.update((draft) => {
      sweepExpired(draft.pending_pairs, now);
      draft.pending_pairs[code] = {
        peer_id: msg.peer_id,
        from_id: msg.from_id,
        kind,
        expires_at: expiresAt.toISOString(),
      };
    });

    const text = pairingMessage(code, kind);
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

  /** Atomic consume: validate, sweep expired, install chat, clear pending entry. */
  async consume(code: string): Promise<ConsumeResult> {
    let outcome: ConsumeResult = { ok: false, reason: "unknown" };
    await this.access.update((draft) => {
      const now = new Date();
      sweepExpired(draft.pending_pairs, now);

      const pending = draft.pending_pairs[code];
      if (!pending) {
        outcome = { ok: false, reason: "unknown" };
        return;
      }

      // Group-chat pairing leaves `senders` empty — the gate treats that as
      // "anyone in this chat may message Claude". DMs always have a single
      // sender (peer_id === from_id), so we seed it for clarity.
      const entry: ChatEntry = {
        kind: pending.kind,
        senders: pending.kind === "group_chat" ? [] : [pending.from_id],
        added_at: now.toISOString(),
        added_by: "pairing",
      };
      draft.chats[String(pending.peer_id)] = entry;
      delete draft.pending_pairs[code];
      outcome = { ok: true, peer_id: pending.peer_id, chat: entry };
    });
    return outcome;
  }

  listPending(): { code: string; pair: PendingPair }[] {
    const file = this.access.get();
    return Object.entries(file.pending_pairs).map(([code, pair]) => ({ code, pair }));
  }
}

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

function sweepExpired(pairs: Record<string, PendingPair>, now: Date): void {
  for (const [code, pair] of Object.entries(pairs)) {
    if (Date.parse(pair.expires_at) <= now.getTime()) delete pairs[code];
  }
}
