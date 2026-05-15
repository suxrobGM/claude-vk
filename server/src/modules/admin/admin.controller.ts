import { Elysia } from "elysia";
import { container } from "@/common/di";
import { ConfigResponseSchema, StateResponseSchema } from "./admin.schema";
import { AdminService } from "./admin.service";

const adminService = container.resolve(AdminService);

/** Mounts read-only admin endpoints under `/admin`. Logic lives in {@link AdminService}. */
export const adminController = new Elysia({ name: "admin", prefix: "/admin", tags: ["Admin"] })
  .get("/config", () => adminService.getConfig(), {
    response: ConfigResponseSchema,
    detail: { summary: "Effective config with secrets redacted." },
  })
  .get("/state", () => adminService.getState(), {
    response: StateResponseSchema,
    detail: { summary: "Process-runtime status snapshot." },
  });
