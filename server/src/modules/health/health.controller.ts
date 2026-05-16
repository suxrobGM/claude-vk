import { Elysia } from "elysia";
import { isMcpReady } from "@/mcp/server";
import { HealthzResponseSchema } from "./health.schema";

export const healthController = new Elysia({ name: "health", tags: ["Health"] }).get(
  "/healthz",
  () => {
    const mcp = isMcpReady();
    return { ok: mcp, mcp };
  },
  {
    response: HealthzResponseSchema,
    detail: {
      summary: "Liveness + readiness probe",
      description:
        "Returns 200 with `{ ok, mcp }`. `ok` reflects overall readiness (currently MCP stdio transport connected). The response itself proves process liveness.",
    },
  },
);
