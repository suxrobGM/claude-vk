import { singleton } from "tsyringe";
import { PluginError } from "@/common/errors";
import { JsonStore } from "./json-store";
import { statePath } from "./paths";
import { STATE_FILE_DEFAULTS, StateFileSchema, type StateFile } from "./state.schema";

const RECENT_MESSAGES_LIMIT = 200;
const RECENT_EVENT_IDS_LIMIT = 10_000;

export type LongpollCursor = { server: string; key: string; ts: string };

/**
 * Typed accessor over `state.json`. Wraps `JsonStore<StateFile>` so callers
 * never reach into raw store internals; M2 uses it for the Long Poll cursor
 * and the recent-messages ring, and M6 will hang the webhook event-id ring
 * off the same file.
 */
@singleton()
export class StateStore {
  private store: JsonStore<StateFile> | null = null;

  /** Load (or create) `state.json`. Idempotent. */
  async init(): Promise<void> {
    if (this.store) {
      return;
    }
    this.store = await JsonStore.create<StateFile>({
      path: statePath,
      schema: StateFileSchema,
      defaults: STATE_FILE_DEFAULTS,
    });
  }

  /** Last long-poll cursor, or `null` if never set. */
  getLongpoll(): LongpollCursor | null {
    return this.getStore().get().longpoll ?? null;
  }

  /** Persist the latest long-poll cursor so a restart can resume. */
  async setLongpoll(cursor: LongpollCursor): Promise<void> {
    await this.getStore().update((draft) => {
      draft.longpoll = cursor;
    });
  }

  /** Append a sent-message to the ring used by M4's reply-to-bot detection. */
  async pushRecentMessage(peer_id: number, conversation_message_id: number): Promise<void> {
    await this.getStore().update((draft) => {
      const list = draft.recent_messages ?? [];
      list.push({ peer_id, conversation_message_id, sent_at: new Date().toISOString() });
      while (list.length > RECENT_MESSAGES_LIMIT) list.shift();
      draft.recent_messages = list;
    });
  }

  /** Recent sent-messages ring. */
  getRecentMessages(): readonly { peer_id: number; conversation_message_id: number }[] {
    return this.getStore().get().recent_messages ?? [];
  }

  /** Record a webhook event_id for dedup (M6). Returns `true` iff unseen. */
  async pushEventId(id: string): Promise<boolean> {
    let isNew = false;
    await this.getStore().update((draft) => {
      const list = draft.recent_event_ids ?? [];

      if (list.includes(id)) {
        return;
      }

      isNew = true;
      list.push(id);
      while (list.length > RECENT_EVENT_IDS_LIMIT) {
        list.shift();
      }
      draft.recent_event_ids = list;
    });
    return isNew;
  }

  private getStore(): JsonStore<StateFile> {
    if (!this.store) {
      throw new PluginError("store_not_initialized", "StateStore accessed before init()");
    }
    return this.store;
  }
}
