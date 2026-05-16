import { t, type Static } from "elysia";
import { NullableString } from "@/types/common.schema";

/** Sanitized snapshot of effective configuration — secrets are redacted. */
export const ConfigResponseSchema = t.Object({
  port: t.Number(),
  vkCommunityId: NullableString,
  vkCommunityScreenName: NullableString,
  vkToken: NullableString,
});

/** Process-runtime status snapshot. */
export const StateResponseSchema = t.Object({
  runtime: t.Object({
    mcpReady: t.Boolean(),
    vkConnected: t.Boolean(),
    lastError: NullableString,
    lastErrorAt: NullableString,
    lastEventAt: NullableString,
  }),
  recentMessagesCount: t.Integer(),
});

export type ConfigResponse = Static<typeof ConfigResponseSchema>;
export type StateResponse = Static<typeof StateResponseSchema>;
