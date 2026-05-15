import { t, type Static } from "elysia";
import { NullableString } from "@/types/common.schema";

/** Sanitized snapshot of effective configuration — secrets are redacted. */
export const ConfigResponseSchema = t.Object({
  port: t.Number(),
  http_bind: t.String(),
  transport: t.String(),
  locale: t.String(),
  permission_relay: t.Boolean(),
  state_dir: NullableString,
  vk_community_id: NullableString,
  vk_community_screen_name: NullableString,
  vk_token: NullableString,
  webhook_secret: NullableString,
});

/** Process-runtime status, merging in-process state with persisted long-poll cursor. */
export const StateResponseSchema = t.Object({
  runtime: t.Object({
    mcp_ready: t.Boolean(),
    transport: t.String(),
    vk_connected: t.Boolean(),
    last_error: NullableString,
    last_error_at: NullableString,
    last_event_at: NullableString,
  }),
  longpoll: t.Union([t.Object({ server: t.String(), key: t.String(), ts: t.String() }), t.Null()]),
  recent_messages_count: t.Integer(),
});

export type ConfigResponse = Static<typeof ConfigResponseSchema>;
export type StateResponse = Static<typeof StateResponseSchema>;
