import { singleton } from "tsyringe";

const LIMIT = 10_000;

/**
 * In-memory FIFO Set for VK Callback API `event_id` dedup. Not persisted —
 * VK's retry window is short (~minutes) and a process restart inside that
 * window may occasionally double-deliver a `message_new` event to Claude.
 * Accepted tradeoff for not having to write state.json on every webhook hit.
 */
@singleton()
export class EventIdDedup {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  /** Record an event_id. Returns true iff it was previously unseen. */
  add(id: string): boolean {
    if (this.seen.has(id)) {
      return false;
    }

    this.seen.add(id);
    this.order.push(id);

    while (this.order.length > LIMIT) {
      const oldest = this.order.shift()!;
      this.seen.delete(oldest);
    }
    return true;
  }
}
