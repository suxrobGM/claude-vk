import { z } from "zod";

/**
 * MCP tool input schemas. The MCP SDK's `registerTool` consumes a
 * `ZodRawShape` — a record of zod schemas keyed by field name — so these are
 * exported as plain objects rather than wrapped `z.object(...)` instances.
 * The SDK validates incoming tool calls against this shape before our handler
 * runs.
 */
export const SendMessageInputShape = {
  peer_id: z
    .number()
    .int()
    .describe("VK peer id (user id for DMs, ≥ 2_000_000_000 for group chats)."),
  text: z.string().min(1).describe("Message text. Auto-chunked at 4096 chars."),
  reply_to: z
    .number()
    .int()
    .optional()
    .describe("conversation_message_id to reply to. Applied only to the first chunk."),
} as const;

export const EditMessageInputShape = {
  peer_id: z.number().int(),
  conversation_message_id: z.number().int(),
  text: z.string().min(1),
} as const;

export const DeleteMessageInputShape = {
  peer_id: z.number().int(),
  conversation_message_id: z.number().int(),
  delete_for_all: z.boolean().optional().default(false),
} as const;

export type SendMessageInput = z.infer<z.ZodObject<typeof SendMessageInputShape>>;
export type EditMessageInput = z.infer<z.ZodObject<typeof EditMessageInputShape>>;
export type DeleteMessageInput = z.infer<z.ZodObject<typeof DeleteMessageInputShape>>;

/**
 * Tool result envelope. Same `{ ok, ... }` discriminated union for every
 * messaging tool, written as TypeScript types (not zod) because the service
 * constructs these — they are never parsed back from untrusted input.
 */
export type ToolFailure = {
  ok: false;
  code: string;
  message: string;
  vk_error_code?: number;
};

export type SendMessageResult = { ok: true; conversation_message_ids: number[] } | ToolFailure;

export type EditMessageResult = { ok: true } | ToolFailure;
export type DeleteMessageResult = { ok: true } | ToolFailure;
