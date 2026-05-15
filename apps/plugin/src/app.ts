import "reflect-metadata";
import { Elysia } from "elysia";
import { bootstrapContainer, container } from "@/common/di";
import { logger } from "@/common/logger";
import { errorMiddleware } from "@/common/middleware";
import { swaggerPlugin } from "@/common/plugins";
import { validateEnv } from "@/env";
import { startMcpServer } from "@/mcp/server";
import { accessController } from "@/modules/access/access.controller";
import { AccessStore } from "@/modules/access/access.store";
import { PairingService } from "@/modules/access/pairing";
import { adminController } from "@/modules/admin/admin.controller";
import { healthController } from "@/modules/health/health.controller";
import { startInbound } from "@/modules/inbound/inbound.startup";
import { UsersCache } from "@/modules/users/users.cache";

validateEnv();
bootstrapContainer();

// Stores must be loaded before any tool resolves — tool handlers can hit them
// at first call, and the MCP transport accepts requests as soon as it connects.
await container.resolve(AccessStore).init();
await container.resolve(UsersCache).init();
await container.resolve(PairingService).pruneExpired();

const mcp = await startMcpServer();
startInbound(mcp);

const app = new Elysia()
  .use(errorMiddleware)
  .use(swaggerPlugin)
  .use(healthController)
  .use(adminController)
  .use(accessController)
  .listen(parseInt(process.env.PORT!));

logger.info(`Plugin server running at http://${app.server?.hostname}:${app.server?.port}`);
