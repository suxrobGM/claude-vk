import { t, type Static } from "elysia";
import { AddedBySchema, DmPolicySchema, MentionPolicySchema } from "./policy.schema";

export const DmEntrySchema = t.Object({
  kind: t.Literal("dm"),
  title: t.Optional(t.String()),
  added_at: t.String(),
  added_by: AddedBySchema,
});

export const GroupChatEntrySchema = t.Object({
  kind: t.Literal("group_chat"),
  title: t.Optional(t.String()),
  senders: t.Array(t.Integer()),
  mention_policy: t.Optional(MentionPolicySchema),
  added_at: t.String(),
  added_by: AddedBySchema,
});

export const ChatEntrySchema = t.Union([DmEntrySchema, GroupChatEntrySchema]);

export const PendingPairSchema = t.Object({
  peer_id: t.Integer(),
  from_id: t.Integer(),
  expires_at: t.String(),
});

export const AccessFileSchema = t.Object({
  version: t.Literal(1, { default: 1 }),
  dm_policy: DmPolicySchema,
  chats: t.Record(t.String(), ChatEntrySchema),
  pending_pairs: t.Record(t.String(), PendingPairSchema),
});

export type DmEntry = Static<typeof DmEntrySchema>;
export type GroupChatEntry = Static<typeof GroupChatEntrySchema>;
export type ChatEntry = Static<typeof ChatEntrySchema>;
export type PendingPair = Static<typeof PendingPairSchema>;
export type AccessFile = Static<typeof AccessFileSchema>;

export const ACCESS_FILE_DEFAULTS: AccessFile = {
  version: 1,
  dm_policy: "pairing",
  chats: {},
  pending_pairs: {},
};
