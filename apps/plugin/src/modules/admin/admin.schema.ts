import { t, type Static } from "elysia";
import { NullableString } from "@/types/common.schema";

/** Sanitized snapshot of effective configuration — secrets are redacted. */
export const ConfigResponseSchema = t.Object({
  port: t.Number(),
  state_dir: t.String(),
  vk_community_id: NullableString,
  vk_community_screen_name: NullableString,
  vk_token: NullableString,
});

/** Process-runtime status snapshot. */
export const StateResponseSchema = t.Object({
  runtime: t.Object({
    mcp_ready: t.Boolean(),
    vk_connected: t.Boolean(),
    last_error: NullableString,
    last_error_at: NullableString,
    last_event_at: NullableString,
  }),
  recent_messages_count: t.Integer(),
});

export type ConfigResponse = Static<typeof ConfigResponseSchema>;
export type StateResponse = Static<typeof StateResponseSchema>;
