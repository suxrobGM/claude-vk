import { t } from "elysia";
import { NumericIdStringSchema, OkResponseSchema } from "@/types/common.schema";
import { ChatEntrySchema, PendingPairSchema } from "./access-file.schema";
import { ChatKindSchema, DmPolicySchema, MentionPolicySchema } from "./policy.schema";

export const PeerIdParamSchema = t.Object({
  peerId: NumericIdStringSchema,
});

export const PeerIdSenderParamSchema = t.Object({
  peerId: NumericIdStringSchema,
  userId: NumericIdStringSchema,
});

export const AddSenderBodySchema = t.Object({
  userId: t.Optional(t.Integer()),
  screenName: t.Optional(t.String({ minLength: 1 })),
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
  peerId: t.Integer(),
  title: t.Optional(t.String({ minLength: 1 })),
  allow: t.Optional(t.Array(t.Integer())),
  mentionPolicy: t.Optional(MentionPolicySchema),
});

export const ChatSummarySchema = t.Object({
  peerId: t.Integer(),
  kind: ChatKindSchema,
  title: t.Union([t.String(), t.Null()]),
  senderCount: t.Integer(),
  addedAt: t.String(),
  addedBy: t.Union([t.Literal("pairing"), t.Literal("manual")]),
});

export const ChatsListResponseSchema = t.Object({
  chats: t.Array(ChatSummarySchema),
});

export const ChatDetailResponseSchema = t.Intersect([
  t.Object({ peerId: t.Integer() }),
  ChatEntrySchema,
]);

export const SendersListResponseSchema = t.Object({
  peerId: t.Integer(),
  senders: t.Array(t.Integer()),
});

export const AddSenderResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peerId: t.Integer(), userId: t.Integer() }),
]);

export const RemoveResponseSchema = OkResponseSchema;

export const RemoveChatResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peerId: t.Integer() }),
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
    peerId: t.Integer(),
    policy: MentionPolicySchema,
  }),
]);

export const ConsumePairingOkSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peerId: t.Integer(), chat: ChatEntrySchema }),
]);

export const AddGroupResponseSchema = t.Composite([
  OkResponseSchema,
  t.Object({ peerId: t.Integer(), chat: ChatEntrySchema }),
]);

export const PendingPairingsResponseSchema = t.Object({
  pending: t.Array(t.Object({ code: t.String(), pair: PendingPairSchema })),
});

export const PendingGroupSchema = t.Object({
  peerId: t.Integer(),
  firstSeen: t.String(),
  lastSeen: t.String(),
  hitCount: t.Integer(),
  sampleFromId: t.Integer(),
  sampleText: t.String(),
});

export const PendingGroupsResponseSchema = t.Object({
  pending: t.Array(PendingGroupSchema),
});
