import { mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { destination, multistream, pino } from "pino";
import { logDir } from "@/state/paths";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

// Single-step rotation (vk.log -> vk.log.1) bounds disk use without a daemon or a dep.
const MAX_LOG_BYTES = 10 * 1024 * 1024;

function rotateIfOversized(file: string): void {
  try {
    if (statSync(file).size < MAX_LOG_BYTES) {
      return;
    }
  } catch {
    return;
  }

  const rotated = `${file}.1`;
  try {
    unlinkSync(rotated);
  } catch {
    // no prior rotation
  }

  try {
    renameSync(file, rotated);
  } catch {
    // Windows may still hold the handle from a prior run; pino reopens and appends.
  }
}

// Tees to `~/.claude/channels/vk/log/vk.log` because Claude Code swallows stderr.
function buildProdLogger() {
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, "vk.log");
  rotateIfOversized(logFile);
  // sync: an async fd is still opening at process.exit, so pino's exit flush throws.
  const fileStream = destination({ dest: logFile, sync: true, mkdir: true });
  return pino(
    { level, base: { plugin: "vk" } },
    multistream([{ stream: destination(2) }, { stream: fileStream }]),
  );
}

/** Logs to stderr only; stdout is reserved for MCP framing. */
export const logger = isDev
  ? pino({
      level,
      transport: { target: "pino-pretty", options: { colorize: true, destination: 2 } },
    })
  : buildProdLogger();
