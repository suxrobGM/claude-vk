import { Elysia } from "elysia";
import { bootstrapContainer, container } from "@/common/di";
import { logger } from "@/common/logger";
import { errorMiddleware } from "@/common/middleware";
import { swaggerPlugin } from "@/common/plugins";
import { current as currentConfig } from "@/config";
import { startMcpServer } from "@/mcp/server";
import { accessController } from "@/modules/access/access.controller";
import { AccessStore } from "@/modules/access/access.store";
import { adminController } from "@/modules/admin/admin.controller";
import { healthController } from "@/modules/health/health.controller";
import { startInbound } from "@/modules/inbound/inbound.startup";
import { UsersCache } from "@/modules/users/users.cache";

bootstrapContainer();

// Stores must be loaded before any tool resolves — tool handlers can hit them
// at first call, and the MCP transport accepts requests as soon as it connects.
await container.resolve(AccessStore).init();
await container.resolve(UsersCache).init();

const mcp = await startMcpServer();
startInbound(mcp);

const c = currentConfig();
const app = new Elysia()
  .use(errorMiddleware)
  .use(swaggerPlugin)
  .use(healthController)
  .use(adminController)
  .use(accessController);

app.listen({ port: c.port, hostname: "127.0.0.1" }, ({ hostname, port }) => {
  logger.info({ hostname, port }, "elysia listening");
});
