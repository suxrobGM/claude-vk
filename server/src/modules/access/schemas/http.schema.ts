import { t } from "elysia";
import { NumericIdStringSchema, OkResponseSchema } from "@/types/common.schema";
import { ChatEntrySchema, PendingPairSchema } from "./access-file.schema";
import { ChatKindSchema, DmPolicySchema, MentionPolicySchema } from "./policy.schema";

export const PeerIdParamSchema = t.Object({
  peer_id: NumericIdStringSchema,
});

export const PeerIdSenderParamSchema = t.Object({
  peer_id: NumericIdStringSchema,
  user_id: NumericIdStringSchema,
});

export const AddSenderBodySchema = t.Object({
  user_id: t.Optional(t.Integer()),
  screen_name: t.Optional(t.String({ minLength: 1 })),
});

export const SetPolicyBodySchema = t.Object({
  policy: DmPolicySchema,
});

export const SetMentionPolicyBodySchema = t.Object({
  policy: MentionPolicySchema,
});

export const ConsumePairingBodySchema = t.Object({
  code: t.String({ minLength: 6, maxLength: 6 }),
});

export const AddGroupBodySchema = t.Object({
  peer_id: t.Integer(),
  title: t.Optional(t.String({ minLength: 1 })),
  allow: t.Optional(t.Array(t.Integer())),
  mention_policy: t.Optional(MentionPolicySchema),
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
});

export const SetPolicyResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ dm: DmPolicySchema }),
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

export const AddGroupResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peer_id: t.Integer(), chat: ChatEntrySchema }),
]);

export const PendingPairingsResponseSchema = t.Object({
  pending: t.Array(t.Object({ code: t.String(), pair: PendingPairSchema })),
});

export const PendingGroupSchema = t.Object({
  peer_id: t.Integer(),
  first_seen: t.String(),
  last_seen: t.String(),
  hit_count: t.Integer(),
  sample_from_id: t.Integer(),
  sample_text: t.String(),
});

export const PendingGroupsResponseSchema = t.Object({
  pending: t.Array(PendingGroupSchema),
});
