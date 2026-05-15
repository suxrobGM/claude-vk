import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { singleton } from "tsyringe";
import { toCallResult } from "@/common/utils/tool-envelope";
import {
  DeleteMessageInputShape,
  EditMessageInputShape,
  MarkReadInputShape,
  ReactInputShape,
  SendMessageInputShape,
  UploadAttachmentInputShape,
  type DeleteMessageInput,
  type EditMessageInput,
  type MarkReadInput,
  type ReactInput,
  type SendMessageInput,
  type UploadAttachmentInput,
} from "./messaging.schema";
import { MessagingService } from "./messaging.service";
import { UploadService } from "./upload-attachment";

/**
 * Adapter that exposes `MessagingService` over the MCP tool surface. One
 * `register()` call per process; the MCP SDK validates input against the zod
 * shapes before our handler runs, so the service receives well-typed args.
 */
@singleton()
export class MessagingTools {
  constructor(
    private readonly service: MessagingService,
    private readonly uploads: UploadService,
  ) {}

  register(server: McpServer): void {
    server.registerTool(
      "send_message",
      {
        description:
          "Send a VK message to `peer_id`. Text is auto-chunked at 4096 chars; " +
          "the response's `conversation_message_ids` is an array containing one entry per chunk.",
        inputSchema: SendMessageInputShape,
      },
      async (args: SendMessageInput) => toCallResult(await this.service.send(args)),
    );

    server.registerTool(
      "edit_message",
      {
        description:
          "Edit a previously-sent VK message. Subject to VK's 24-hour and own-message rules.",
        inputSchema: EditMessageInputShape,
      },
      async (args: EditMessageInput) => toCallResult(await this.service.edit(args)),
    );

    server.registerTool(
      "delete_message",
      {
        description:
          "Delete a VK message by `conversation_message_id`. Set `delete_for_all` to remove for both sides (24h window).",
        inputSchema: DeleteMessageInputShape,
      },
      async (args: DeleteMessageInput) => toCallResult(await this.service.delete(args)),
    );

    server.registerTool(
      "react",
      {
        description:
          "Add or replace a reaction on a message. `reaction_id` is from VK's enumerated set.",
        inputSchema: ReactInputShape,
      },
      async (args: ReactInput) => toCallResult(await this.service.react(args)),
    );

    server.registerTool(
      "mark_read",
      {
        description:
          "Mark a peer's messages as read up to `start_message_id` (or all unread when omitted).",
        inputSchema: MarkReadInputShape,
      },
      async (args: MarkReadInput) => toCallResult(await this.service.markRead(args)),
    );

    server.registerTool(
      "upload_attachment",
      {
        description:
          "Upload a local file to VK and return its canonical `photo<owner>_<id>` " +
          "or `doc<owner>_<id>` reference. Auto-detects photo vs doc vs voice by extension; " +
          "override with `kind`. Pass the returned `vk_ref` into a follow-up `send_message`.",
        inputSchema: UploadAttachmentInputShape,
      },
      async (args: UploadAttachmentInput) => toCallResult(await this.uploads.upload(args)),
    );
  }
}
