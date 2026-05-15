import { z } from "zod";
import type { ToolFailure } from "@/common/utils/tool-envelope";

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

export const ReactInputShape = {
  peer_id: z.number().int(),
  conversation_message_id: z.number().int(),
  reaction_id: z
    .number()
    .int()
    .min(1)
    .describe("VK reaction id (positive integer from VK's enumerated set)."),
} as const;

export const MarkReadInputShape = {
  peer_id: z.number().int(),
  start_message_id: z
    .number()
    .int()
    .optional()
    .describe("Mark as read up to this message_id; omit to mark all unread."),
} as const;

export const UploadAttachmentInputShape = {
  peer_id: z.number().int(),
  path: z.string().min(1).describe("Absolute path to a local file (≤ 50 MB)."),
  kind: z
    .enum(["auto", "photo", "doc", "voice"])
    .optional()
    .default("auto")
    .describe("Override extension-based detection."),
} as const;

export type SendMessageInput = z.infer<z.ZodObject<typeof SendMessageInputShape>>;
export type EditMessageInput = z.infer<z.ZodObject<typeof EditMessageInputShape>>;
export type DeleteMessageInput = z.infer<z.ZodObject<typeof DeleteMessageInputShape>>;
export type ReactInput = z.infer<z.ZodObject<typeof ReactInputShape>>;
export type MarkReadInput = z.infer<z.ZodObject<typeof MarkReadInputShape>>;
export type UploadAttachmentInput = z.infer<z.ZodObject<typeof UploadAttachmentInputShape>>;

export type SendMessageResult = { ok: true; conversation_message_ids: number[] } | ToolFailure;
export type EditMessageResult = { ok: true } | ToolFailure;
export type DeleteMessageResult = { ok: true } | ToolFailure;
export type ReactResult = { ok: true } | ToolFailure;
export type MarkReadResult = { ok: true } | ToolFailure;
export type UploadAttachmentResult = { ok: true; vk_ref: string } | ToolFailure;
