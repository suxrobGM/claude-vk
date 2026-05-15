import { t, type Static } from "elysia";

export const HealthzResponseSchema = t.Object({
  ok: t.Boolean(),
});

export const ReadyzResponseSchema = t.Object({
  ok: t.Boolean(),
  mcp: t.Boolean(),
});

export type HealthzResponse = Static<typeof HealthzResponseSchema>;
export type ReadyzResponse = Static<typeof ReadyzResponseSchema>;
