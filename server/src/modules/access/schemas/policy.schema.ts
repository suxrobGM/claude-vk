import { t, type Static } from "elysia";

export const DmPolicySchema = t.Union([
  t.Literal("pairing"),
  t.Literal("allowlist"),
  t.Literal("disabled"),
]);

export const ChatKindSchema = t.Union([t.Literal("dm"), t.Literal("group_chat")]);

export const MentionPolicySchema = t.Union([
  t.Literal("mention_only"),
  t.Literal("all"),
  t.Literal("reply_only"),
]);

export const AddedBySchema = t.Union([t.Literal("pairing"), t.Literal("manual")]);

export type DmPolicy = Static<typeof DmPolicySchema>;
export type ChatKind = Static<typeof ChatKindSchema>;
export type MentionPolicy = Static<typeof MentionPolicySchema>;
export type AddedBy = Static<typeof AddedBySchema>;
