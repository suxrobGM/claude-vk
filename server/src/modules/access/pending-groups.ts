import { singleton } from "tsyringe";

const MAX_ENTRIES = 20;

export interface PendingGroup {
  peerId: number;
  firstSeen: string;
  lastSeen: string;
  hitCount: number;
  sampleFromId: number;
  sampleText: string;
}

interface RecordPendingGroupInput {
  peerId: number;
  fromId: number;
  text: string;
}

/**
 * Tracks group-chat `peerId`s the gate dropped as `chat-not-allowed` so the
 * operator can copy the right number into `/vk:access group add` without
 * digging through logs. VK peer_ids are context-relative — the URL-bar number
 * a user sees differs from what the community's Long Poll delivers.
 */
@singleton()
export class PendingGroupsRegistry {
  private readonly entries = new Map<number, PendingGroup>();

  record(input: RecordPendingGroupInput): void {
    const now = new Date().toISOString();
    const existing = this.entries.get(input.peerId);

    if (existing) {
      existing.lastSeen = now;
      existing.hitCount += 1;
      return;
    }

    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = [...this.entries.entries()].sort((a, b) =>
        a[1].lastSeen.localeCompare(b[1].lastSeen),
      )[0];

      if (oldest) {
        this.entries.delete(oldest[0]);
      }
    }

    this.entries.set(input.peerId, {
      peerId: input.peerId,
      firstSeen: now,
      lastSeen: now,
      hitCount: 1,
      sampleFromId: input.fromId,
      sampleText: input.text.slice(0, 80),
    });
  }

  /** Called from `AccessService` after a group chat is opted in. */
  forget(peerId: number): void {
    this.entries.delete(peerId);
  }

  /** Most-recent first. */
  list(): PendingGroup[] {
    return [...this.entries.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }
}
