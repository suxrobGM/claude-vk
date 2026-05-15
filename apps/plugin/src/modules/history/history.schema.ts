import { z } from "zod";
import type { ToolFailure } from "@/common/utils/tool-envelope";
import type { GetHistoryResponse, SearchMessagesResponse } from "@/vk/api.types";

/**
 * MCP tool input schemas for the history module. Same `*InputShape` plain-zod
 * convention as messaging — the MCP SDK consumes the raw shape and validates
 * before calling our handler.
 */
export const GetHistoryInputShape = {
  peer_id: z.number().int(),
  count: z.number().int().min(1).max(200).optional().default(20),
  offset: z.number().int().min(0).optional(),
  start_message_id: z.number().int().optional(),
  extended: z
    .boolean()
    .optional()
    .default(false)
    .describe("Resolve participating users into `profiles[]`."),
} as const;

export const SearchMessagesInputShape = {
  q: z.string().min(1),
  peer_id: z.number().int().optional().describe("Scope search to one peer."),
  count: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional(),
} as const;

export type GetHistoryInput = z.infer<z.ZodObject<typeof GetHistoryInputShape>>;
export type SearchMessagesInput = z.infer<z.ZodObject<typeof SearchMessagesInputShape>>;

export type GetHistoryResult = { ok: true; data: GetHistoryResponse } | ToolFailure;
export type SearchMessagesResult = { ok: true; data: SearchMessagesResponse } | ToolFailure;
