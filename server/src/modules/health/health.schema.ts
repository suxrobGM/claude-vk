import { t, type Static } from "elysia";

// Combined liveness + readiness probe
export const HealthzResponseSchema = t.Object({
  ok: t.Boolean(),
  mcp: t.Boolean(),
});

export type HealthzResponse = Static<typeof HealthzResponseSchema>;
