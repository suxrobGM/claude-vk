import { z } from "zod";
import type { ToolFailure } from "@/common/utils/tool-envelope";
import type { GetHistoryResponse, SearchMessagesResponse } from "@/vk/api.types";

/** MCP tool input schemas for the history module. Same `*InputSchema` convention as messaging. */
export const GetHistoryInputSchema = z.object({
  peer_id: z.number().int(),
  count: z.number().int().min(1).max(200).optional().default(20),
  offset: z.number().int().min(0).optional(),
  start_message_id: z.number().int().optional(),
  extended: z
    .boolean()
    .optional()
    .default(false)
    .describe("Resolve participating users into `profiles[]`."),
});

export const SearchMessagesInputSchema = z.object({
  q: z.string().min(1),
  peer_id: z.number().int().optional().describe("Scope search to one peer."),
  count: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional(),
});

export type GetHistoryInput = z.infer<typeof GetHistoryInputSchema>;
export type SearchMessagesInput = z.infer<typeof SearchMessagesInputSchema>;

export type GetHistoryResult = { ok: true; data: GetHistoryResponse } | ToolFailure;
export type SearchMessagesResult = { ok: true; data: SearchMessagesResponse } | ToolFailure;
