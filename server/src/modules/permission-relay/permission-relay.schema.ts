import { z } from "zod";

export const PERMISSION_REQUEST_METHOD = "notifications/claude/channel/permission_request";

/**
 * Params schema for `notifications/claude/channel/permission_request`.
 * `tool_input` and `description` are kept loose because the channels reference
 * doesn't pin every payload field — we use what we recognize and ignore extras.
 */
export const PermissionRequestParamsSchema = z.object({
  request_id: z.string(),
  tool_name: z.string(),
  tool_input: z.unknown().optional(),
  description: z.string().optional(),
});

export type PermissionRequestParams = z.infer<typeof PermissionRequestParamsSchema>;
