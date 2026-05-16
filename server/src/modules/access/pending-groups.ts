import { singleton } from "tsyringe";

const MAX_ENTRIES = 20;

export interface PendingGroup {
  peer_id: number;
  first_seen: string;
  last_seen: string;
  hit_count: number;
  sample_from_id: number;
  sample_text: string;
}

interface RecordPendingGroupInput {
  peer_id: number;
  from_id: number;
  text: string;
}

/**
 * Tracks group-chat `peer_id`s the gate dropped as `chat-not-allowed` so the
 * operator can copy the right number into `/vk:access group add` without
 * digging through logs. VK peer_ids are context-relative — the URL-bar number
 * a user sees differs from what the community's Long Poll delivers.
 */
@singleton()
export class PendingGroupsRegistry {
  private readonly entries = new Map<number, PendingGroup>();

  record(input: RecordPendingGroupInput): void {
    const now = new Date().toISOString();
    const existing = this.entries.get(input.peer_id);

    if (existing) {
      existing.last_seen = now;
      existing.hit_count += 1;
      return;
    }

    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = [...this.entries.entries()].sort((a, b) =>
        a[1].last_seen.localeCompare(b[1].last_seen),
      )[0];

      if (oldest) {
        this.entries.delete(oldest[0]);
      }
    }

    this.entries.set(input.peer_id, {
      peer_id: input.peer_id,
      first_seen: now,
      last_seen: now,
      hit_count: 1,
      sample_from_id: input.from_id,
      sample_text: input.text.slice(0, 80),
    });
  }

  /** Called from `AccessService` after a group chat is opted in. */
  forget(peerId: number): void {
    this.entries.delete(peerId);
  }

  /** Most-recent first. */
  list(): PendingGroup[] {
    return [...this.entries.values()].sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  }
}
