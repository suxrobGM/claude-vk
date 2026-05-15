import { singleton } from "tsyringe";
import { PluginError } from "@/common/errors";
import { logger } from "@/common/logger";
import { JsonStore } from "@/state/json-store";
import { peersPath } from "@/state/paths";
import { VkClient } from "@/vk/client";
import {
  PEERS_FILE_DEFAULTS,
  PeersFileSchema,
  type PeersFile,
  type UserEntry,
} from "./users.schema";

const TTL_MS = 60 * 60 * 1000; // 1h, PRD §13
const LRU_LIMIT = 10_000; // PRD §19 open question — adopt recommended cap
const LRU_WARN = 8_000;

/**
 * Display-name cache for VK users (and, when M4 lands, groups). Reads hit
 * the in-memory copy, misses go through `users.get` and persist back to
 * `peers.json`. Stale entries (>1h) are refreshed lazily on next access.
 *
 * Failures (no token, VK error, network) return a fallback name like
 * `user_123456` so the inbound notifier always has *some* string for
 * `from_name` — we never block a channel notification on a metadata fetch.
 */
@singleton()
export class UsersCache {
  private store: JsonStore<PeersFile> | null = null;
  private screenToId = new Map<string, number>();

  constructor(private readonly vk: VkClient) {}

  /** Load `peers.json` and rebuild the screen-name reverse index. Idempotent. */
  async init(): Promise<void> {
    if (this.store) {
      return;
    }
    this.store = await JsonStore.create<PeersFile>({
      path: peersPath,
      schema: PeersFileSchema,
      defaults: PEERS_FILE_DEFAULTS,
    });
    for (const [, entry] of Object.entries(this.store.get().users)) {
      if (entry.screen_name) {
        this.screenToId.set(entry.screen_name.toLowerCase(), entry.id);
      }
    }
  }

  /** Resolve a user_id to a display name. Always returns *some* string. */
  async resolve(userId: number): Promise<string> {
    return (await this.getFull(userId))?.name ?? `user_${userId}`;
  }

  /**
   * Resolve a user_id to its full cached entry. Hits the in-memory cache when
   * fresh (< 1h), otherwise fetches from VK and persists. Returns the stale
   * cached entry if VK is unreachable; `null` only when never seen.
   */
  async getFull(userId: number): Promise<UserEntry | null> {
    const cached = this.getCached(userId);
    if (cached && !isStale(cached)) {
      return cached;
    }
    const fetched = await this.fetchOne(userId);
    if (fetched) {
      return fetched;
    }
    return cached;
  }

  /** Resolve a `screen_name` (with or without leading `@`) to a user_id. */
  async resolveScreenName(screenName: string): Promise<number | null> {
    const key = screenName.replace(/^@/, "").toLowerCase();
    if (!key) {
      return null;
    }
    const cached = this.screenToId.get(key);
    if (cached != null) {
      return cached;
    }

    const fetched = await this.fetchOne(key);
    if (fetched) {
      return fetched.id;
    }
    return null;
  }

  private getCached(userId: number): UserEntry | null {
    return this.getStore().get().users[String(userId)] ?? null;
  }

  private async fetchOne(idOrScreen: number | string): Promise<UserEntry | null> {
    try {
      const raw = await this.vk.usersGet({
        user_ids: String(idOrScreen),
        fields: "screen_name,photo_100",
      });

      const u = raw[0];
      if (!u) {
        return null;
      }

      const entry: UserEntry = {
        id: u.id,
        name: [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || `user_${u.id}`,
        screen_name: u.screen_name,
        photo: u.photo_100,
        cached_at: new Date().toISOString(),
      };

      await this.persist(entry);
      return entry;
    } catch (err) {
      logger.warn({ idOrScreen, err }, "users.get failed; returning fallback name");
      return null;
    }
  }

  private async persist(entry: UserEntry): Promise<void> {
    await this.getStore().update((draft) => {
      draft.users[String(entry.id)] = entry;
      evictIfNeeded(draft.users);
    });
    if (entry.screen_name) {
      this.screenToId.set(entry.screen_name.toLowerCase(), entry.id);
    }
  }

  private getStore(): JsonStore<PeersFile> {
    if (!this.store) {
      throw new PluginError("store_not_initialized", "UsersCache accessed before init()");
    }
    return this.store;
  }
}

function isStale(entry: UserEntry): boolean {
  return Date.now() - Date.parse(entry.cached_at) > TTL_MS;
}

function evictIfNeeded(users: Record<string, UserEntry>): void {
  const count = Object.keys(users).length;
  if (count === LRU_WARN) {
    logger.warn({ count }, "peers.json approaching LRU cap");
  }
  if (count <= LRU_LIMIT) {
    return;
  }

  // Drop the oldest entries by cached_at until we're under the cap.
  const sorted = Object.entries(users).sort(
    ([, a], [, b]) => Date.parse(a.cached_at) - Date.parse(b.cached_at),
  );

  const dropCount = count - LRU_LIMIT;
  for (let i = 0; i < dropCount; i++) {
    const [key] = sorted[i]!;
    delete users[key];
  }
}
