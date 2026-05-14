import { destination, pino } from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

/**
 * MCP stdio servers MUST keep stdout free of non-protocol bytes — every log
 * line is routed to stderr (fd 2). In dev we add pino-pretty for readability,
 * still on stderr; in prod we emit raw JSON straight to stderr.
 */
export const logger = isDev
  ? pino({
      level,
      transport: { target: "pino-pretty", options: { colorize: true, destination: 2 } },
    })
  : pino({ level, base: { plugin: "vk" } }, destination(2));
