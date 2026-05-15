import { t, type Static } from "elysia";
import { NumericIdStringSchema, OkResponseSchema } from "@/types/common.schema";

/**
 * Persistent shape of `~/.claude/channels/vk/access.json`. The DM half is
 * fully exercised in M2/M3; the group-chat half (M4) is already shaped here
 * so the gate, pairing, and admin controller don't have to grow new branches
 * later — they just stop dropping `is_group_chat` paths.
 */

export const DmPolicySchema = t.Union([
  t.Literal("pairing"),
  t.Literal("allowlist"),
  t.Literal("open"),
]);

export const GroupChatPolicySchema = t.Union([t.Literal("pairing"), t.Literal("allowlist")]);

export const ChatKindSchema = t.Union([t.Literal("dm"), t.Literal("group_chat")]);

export const MentionPolicySchema = t.Union([
  t.Literal("mention_only"),
  t.Literal("all"),
  t.Literal("reply_only"),
]);

export const ChatEntrySchema = t.Object({
  kind: ChatKindSchema,
  title: t.Optional(t.String()),
  senders: t.Array(t.Integer()),
  mention_policy: t.Optional(MentionPolicySchema),
  added_at: t.String(),
  added_by: t.Union([t.Literal("pairing"), t.Literal("manual")]),
});

export const PendingPairSchema = t.Object({
  peer_id: t.Integer(),
  from_id: t.Integer(),
  kind: ChatKindSchema,
  expires_at: t.String(),
});

export const AccessFileSchema = t.Object({
  version: t.Literal(1, { default: 1 }),
  policies: t.Object({
    dm: DmPolicySchema,
    group_chat: GroupChatPolicySchema,
  }),
  chats: t.Record(t.String(), ChatEntrySchema),
  pending_pairs: t.Record(t.String(), PendingPairSchema),
});

export type AccessFile = Static<typeof AccessFileSchema>;
export type ChatEntry = Static<typeof ChatEntrySchema>;
export type PendingPair = Static<typeof PendingPairSchema>;
export type ChatKind = Static<typeof ChatKindSchema>;
export type DmPolicy = Static<typeof DmPolicySchema>;
export type GroupChatPolicy = Static<typeof GroupChatPolicySchema>;
export type MentionPolicy = Static<typeof MentionPolicySchema>;

export const ACCESS_FILE_DEFAULTS: AccessFile = {
  version: 1,
  policies: { dm: "pairing", group_chat: "pairing" },
  chats: {},
  pending_pairs: {},
};

/* ----- HTTP transport schemas (params / body / response) ----------------- */

export const PeerIdParamSchema = t.Object({
  peer_id: NumericIdStringSchema,
});

export const PeerIdSenderParamSchema = t.Object({
  peer_id: NumericIdStringSchema,
  user_id: NumericIdStringSchema,
});

export const PeerTypeParamSchema = t.Object({
  peer_type: t.Union([t.Literal("dm"), t.Literal("group_chat")]),
});

export const AddSenderBodySchema = t.Object({
  user_id: t.Optional(t.Integer()),
  screen_name: t.Optional(t.String({ minLength: 1 })),
});

export const SetPolicyBodySchema = t.Object({
  policy: t.Union([DmPolicySchema, GroupChatPolicySchema]),
});

export const SetMentionPolicyBodySchema = t.Object({
  policy: MentionPolicySchema,
});

export const ConsumePairingBodySchema = t.Object({
  code: t.String({ minLength: 6, maxLength: 6 }),
});

export const ChatSummarySchema = t.Object({
  peer_id: t.Integer(),
  kind: ChatKindSchema,
  title: t.Union([t.String(), t.Null()]),
  sender_count: t.Integer(),
  added_at: t.String(),
  added_by: t.Union([t.Literal("pairing"), t.Literal("manual")]),
});

export const ChatsListResponseSchema = t.Object({
  chats: t.Array(ChatSummarySchema),
});

export const ChatDetailResponseSchema = t.Intersect([
  t.Object({ peer_id: t.Integer() }),
  ChatEntrySchema,
]);

export const SendersListResponseSchema = t.Object({
  peer_id: t.Integer(),
  senders: t.Array(t.Integer()),
});

export const AddSenderResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peer_id: t.Integer(), user_id: t.Integer() }),
]);

export const RemoveResponseSchema = OkResponseSchema;

export const RemoveChatResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peer_id: t.Integer() }),
]);

export const PoliciesResponseSchema = t.Object({
  dm: DmPolicySchema,
  group_chat: GroupChatPolicySchema,
});

export const SetPolicyResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({
    peer_type: t.Union([t.Literal("dm"), t.Literal("group_chat")]),
    policy: t.Union([DmPolicySchema, GroupChatPolicySchema]),
  }),
]);

export const SetMentionPolicyResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({
    peer_id: t.Integer(),
    policy: MentionPolicySchema,
  }),
]);

export const ConsumePairingOkSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peer_id: t.Integer(), chat: ChatEntrySchema }),
]);

export const PendingPairingsResponseSchema = t.Object({
  pending: t.Array(t.Object({ code: t.String(), pair: PendingPairSchema })),
});
