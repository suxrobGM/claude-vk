import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { logger } from "@/common/logger";
import { current as currentConfig } from "@/config";
import { startMcpServer } from "@/mcp/server";
import { healthController } from "@/modules/health";

await startMcpServer();

const c = currentConfig();
new Elysia()
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "claude-vk admin API",
          version: "0.1.0",
          description:
            "Local-only HTTP surface for the VK channel plugin. Health probes, webhook receiver " +
            "(when transport=callback), and admin endpoints consumed by the /vk:* skills.",
        },
        tags: [
          { name: "Health", description: "Liveness and readiness probes." },
          { name: "Admin", description: "Cross-cutting admin endpoints (M3+)." },
        ],
      },
    }),
  )
  .use(healthController)
  .listen({ port: c.port, hostname: c.httpBind }, ({ hostname, port }) => {
    logger.info({ hostname, port }, "elysia listening");
  });
