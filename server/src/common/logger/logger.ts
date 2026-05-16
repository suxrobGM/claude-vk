import { mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { destination, multistream, pino } from "pino";
import { logDir } from "@/state/paths";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

// One rotation: vk.log → vk.log.1 (overwriting any previous .1) once the
// active file crosses MAX_LOG_BYTES. Single-step rotation keeps disk usage
// bounded at 2× MAX_LOG_BYTES without needing a daemon or a dep.
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
    // no prior rotation — fine
  }

  try {
    renameSync(file, rotated);
  } catch {
    // rename can fail mid-flight on Windows if a previous run still holds the
    // handle; fall through and let pino reopen and append.
  }
}

// Logs go to stderr only — stdout is reserved for the MCP framing. Prod also
// tees to `~/.claude/channels/vk/log/vk.log` since Claude Code swallows stderr.
function buildProdLogger() {
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, "vk.log");
  rotateIfOversized(logFile);
  const fileStream = destination({ dest: logFile, sync: false, mkdir: true });
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
