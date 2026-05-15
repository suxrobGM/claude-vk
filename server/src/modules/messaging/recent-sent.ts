import { singleton } from "tsyringe";

const LIMIT = 200;

export interface RecentMessage {
  peer_id: number;
  conversation_message_id: number;
}

/**
 * In-memory ring of recently-sent (peer_id, cmid) pairs. Used by
 * `MentionDetector.isReplyToBot` to recognize replies to the bot's own
 * messages within the current process lifetime. Not persisted — the window
 * resets on restart, which is fine because reply-to-bot is a very-recent
 * signal anyway.
 */
@singleton()
export class RecentSentMessages {
  private readonly ring: RecentMessage[] = [];

  push(peer_id: number, conversation_message_id: number): void {
    this.ring.push({ peer_id, conversation_message_id });
    while (this.ring.length > LIMIT) this.ring.shift();
  }

  all(): readonly RecentMessage[] {
    return this.ring;
  }

  size(): number {
    return this.ring.length;
  }
}
