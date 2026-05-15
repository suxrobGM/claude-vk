import { singleton } from "tsyringe";
import { runWithEnvelope } from "@/common/utils/tool-envelope";
import { VkClient } from "@/vk/client";
import type {
  GetHistoryInput,
  GetHistoryResult,
  SearchMessagesInput,
  SearchMessagesResult,
} from "./history.schema";

/** Read-side VK ops — the VK-vs-Telegram differentiator surface. */
@singleton()
export class HistoryService {
  constructor(private readonly vk: VkClient) {}

  async getConversationHistory(input: GetHistoryInput): Promise<GetHistoryResult> {
    return runWithEnvelope("get_conversation_history", async () => {
      const data = await this.vk.getHistory({
        peer_id: input.peer_id,
        count: input.count,
        offset: input.offset,
        start_message_id: input.start_message_id,
        extended: input.extended ? 1 : 0,
      });
      return { ok: true, data } as const;
    });
  }

  async searchMessages(input: SearchMessagesInput): Promise<SearchMessagesResult> {
    return runWithEnvelope("search_messages", async () => {
      const data = await this.vk.searchMessages({
        q: input.q,
        peer_id: input.peer_id,
        count: input.count,
        offset: input.offset,
      });
      return { ok: true, data } as const;
    });
  }
}
