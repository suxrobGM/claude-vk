import { Elysia } from "elysia";
import { isMcpReady } from "@/mcp/server";
import { HealthzResponseSchema, ReadyzResponseSchema } from "./health.schema";

export const healthController = new Elysia({ name: "health", tags: ["Health"] })
  .get("/healthz", () => ({ ok: true }), {
    response: HealthzResponseSchema,
    detail: {
      summary: "Liveness probe",
      description: "Returns 200 as long as the Bun process is up and Elysia is serving.",
    },
  })
  .get(
    "/readyz",
    () => {
      const mcp = isMcpReady();
      return { ok: mcp, mcp };
    },
    {
      response: ReadyzResponseSchema,
      detail: {
        summary: "Readiness probe",
        description:
          "Reports whether the MCP stdio transport has connected. Use to gate traffic when running under a supervisor.",
      },
    },
  );
