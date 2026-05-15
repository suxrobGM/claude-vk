import { z } from "zod";

/**
 * MCP notification schema for `notifications/claude/channel/permission_request`.
 * Shape mirrors what `setNotificationHandler` expects (`{ method, params }`).
 * `params.tool_input` and `description` are kept loose because the channels
 * reference doesn't pin every payload field — we use what we recognize and
 * ignore extras.
 */
export const PermissionRequestParamsSchema = z.object({
  request_id: z.string(),
  tool_name: z.string(),
  tool_input: z.unknown().optional(),
  description: z.string().optional(),
});

export const PermissionRequestNotificationSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: PermissionRequestParamsSchema,
});

export type PermissionRequestParams = z.infer<typeof PermissionRequestParamsSchema>;
