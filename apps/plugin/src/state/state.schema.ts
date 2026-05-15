import { t, type Static } from "elysia";

/**
 * Operational state file (`~/.claude/channels/vk/state.json`). Built in M1 as
 * a schema anchor; the first real consumer is M2 (long-poll cursor). Every
 * field is optional with a sensible default so future milestones can extend
 * without forcing migrations.
 */
export const StateFileSchema = t.Object({
  version: t.Literal(1, { default: 1 }),
  longpoll: t.Optional(
    t.Object({
      server: t.String(),
      key: t.String(),
      ts: t.String(),
    }),
  ),
  recent_event_ids: t.Optional(t.Array(t.String())),
  recent_messages: t.Optional(
    t.Array(
      t.Object({
        peer_id: t.Integer(),
        conversation_message_id: t.Integer(),
        sent_at: t.String(),
      }),
    ),
  ),
});

export type StateFile = Static<typeof StateFileSchema>;

export const STATE_FILE_DEFAULTS: StateFile = { version: 1 };
