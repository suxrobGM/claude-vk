import { Elysia } from "elysia";
import { container } from "@/common/di";
import { ConfigResponseSchema, StateResponseSchema } from "./runtime.schema";
import { RuntimeService } from "./runtime.service";

const runtimeService = container.resolve(RuntimeService);

/** Mounts read-only runtime endpoints. Logic lives in {@link RuntimeService}. */
export const runtimeController = new Elysia({ name: "runtime", tags: ["Runtime"] })
  .get("/config", () => runtimeService.getConfig(), {
    response: ConfigResponseSchema,
    detail: { summary: "Effective config with secrets redacted." },
  })
  .get("/state", () => runtimeService.getState(), {
    response: StateResponseSchema,
    detail: { summary: "Process-runtime status snapshot." },
  });
