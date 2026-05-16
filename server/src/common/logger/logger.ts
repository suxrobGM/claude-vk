import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { destination, multistream, pino } from "pino";
import { logDir } from "@/state/paths";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

// Logs go to stderr only — stdout is reserved for the MCP framing. Prod also
// tees to `~/.claude/channels/vk/log/vk.log` since Claude Code swallows stderr.
function buildProdLogger() {
  mkdirSync(logDir, { recursive: true });
  const fileStream = destination({ dest: join(logDir, "vk.log"), sync: false, mkdir: true });
  return pino(
    { level, base: { plugin: "vk" } },
    multistream([{ stream: destination(2) }, { stream: fileStream }]),
  );
}

export const logger = isDev
  ? pino({
      level,
      transport: { target: "pino-pretty", options: { colorize: true, destination: 2 } },
    })
  : buildProdLogger();
