import { z } from "zod";
import type { ToolFailure } from "@/common/utils/tool-envelope";

/**
 * MCP tool input schemas. `registerTool` takes a Standard Schema, so these are
 * `z.object(...)` instances; the SDK validates incoming calls before our handler runs.
 */
export const SendMessageInputSchema = z.object({
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
});

export const EditMessageInputSchema = z.object({
  peer_id: z.number().int(),
  conversation_message_id: z.number().int(),
  text: z.string().min(1),
});

export const DeleteMessageInputSchema = z.object({
  peer_id: z.number().int(),
  conversation_message_id: z.number().int(),
  delete_for_all: z.boolean().optional().default(false),
});

export const ReactInputSchema = z.object({
  peer_id: z.number().int(),
  conversation_message_id: z.number().int(),
  reaction_id: z
    .number()
    .int()
    .min(1)
    .describe("VK reaction id (positive integer from VK's enumerated set)."),
});

export const MarkReadInputSchema = z.object({
  peer_id: z.number().int(),
  start_message_id: z
    .number()
    .int()
    .optional()
    .describe("Mark as read up to this message_id; omit to mark all unread."),
});

export const UploadAttachmentInputSchema = z.object({
  peer_id: z.number().int(),
  path: z.string().min(1).describe("Absolute path to a local file (≤ 50 MB)."),
  kind: z
    .enum(["auto", "photo", "doc", "voice"])
    .optional()
    .default("auto")
    .describe("Override extension-based detection."),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type EditMessageInput = z.infer<typeof EditMessageInputSchema>;
export type DeleteMessageInput = z.infer<typeof DeleteMessageInputSchema>;
export type ReactInput = z.infer<typeof ReactInputSchema>;
export type MarkReadInput = z.infer<typeof MarkReadInputSchema>;
export type UploadAttachmentInput = z.infer<typeof UploadAttachmentInputSchema>;

export type SendMessageResult = { ok: true; conversation_message_ids: number[] } | ToolFailure;
export type EditMessageResult = { ok: true } | ToolFailure;
export type DeleteMessageResult = { ok: true } | ToolFailure;
export type ReactResult = { ok: true } | ToolFailure;
export type MarkReadResult = { ok: true } | ToolFailure;
export type UploadAttachmentResult = { ok: true; vk_ref: string } | ToolFailure;
