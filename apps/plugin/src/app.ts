import { Elysia } from "elysia";
import { bootstrapContainer } from "@/common/di";
import { logger } from "@/common/logger";
import { errorMiddleware } from "@/common/middleware";
import { swaggerPlugin } from "@/common/plugins";
import { current as currentConfig } from "@/config";
import { startMcpServer } from "@/mcp/server";
import { accessController } from "@/modules/access";
import { adminController } from "@/modules/admin";
import { healthController } from "@/modules/health";
import { inboundController, startInbound } from "@/modules/inbound";

bootstrapContainer();
const mcp = await startMcpServer();
await startInbound(mcp);

const c = currentConfig();
const app = new Elysia()
  .use(errorMiddleware)
  .use(swaggerPlugin)
  .use(healthController)
  .use(adminController)
  .use(accessController);

if (c.transport === "callback") {
  app.use(inboundController);
}

app.listen({ port: c.port, hostname: c.httpBind }, ({ hostname, port }) => {
  logger.info({ hostname, port }, "elysia listening");
});
