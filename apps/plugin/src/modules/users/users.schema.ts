import { t, type Static } from "elysia";

/**
 * Cache of VK user/group metadata at `peers.json`. Mode 0644 — no secrets,
 * just resolved display names so the inbound notifier can put `from_name`
 * on `<channel>` tags without an extra API hop per message. TTL is enforced
 * in code, not on the file.
 */
export const UserEntrySchema = t.Object({
  id: t.Integer(),
  name: t.String(),
  screen_name: t.Optional(t.String()),
  photo: t.Optional(t.String()),
  cached_at: t.String(),
});

export const GroupEntrySchema = t.Object({
  id: t.Integer(),
  name: t.String(),
  screen_name: t.Optional(t.String()),
  photo: t.Optional(t.String()),
  cached_at: t.String(),
});

export const PeersFileSchema = t.Object({
  version: t.Literal(1, { default: 1 }),
  users: t.Record(t.String(), UserEntrySchema),
  groups: t.Record(t.String(), GroupEntrySchema),
});

export type PeersFile = Static<typeof PeersFileSchema>;
export type UserEntry = Static<typeof UserEntrySchema>;
export type GroupEntry = Static<typeof GroupEntrySchema>;

export const PEERS_FILE_DEFAULTS: PeersFile = {
  version: 1,
  users: {},
  groups: {},
};
