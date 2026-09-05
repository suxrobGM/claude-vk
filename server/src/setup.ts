import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { channelDir, envPath } from "@/state/paths";
import {
  hasCommand,
  installCron,
  installedFiles,
  pluginRoot,
  renderTemplate,
  resolveWorkdir,
  respawnPath,
  SESSION,
  sessionRunning,
} from "@/vps";

const PLUGIN_ROOT = pluginRoot();
const TEMPLATES = join(PLUGIN_ROOT, "deploy");

function pluginVersion(): string {
  try {
    const manifest = readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8");
    return (JSON.parse(manifest) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function write(path: string, content: string, mode?: number): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");

  if (mode !== undefined) {
    try {
      chmodSync(path, mode);
    } catch {
      // Windows has no POSIX modes; the VPS is where this matters.
    }
  }
}

/** The plugin owns these files, so an update always wins. */
function install(name: string, dest: string, workdir: string, mode?: number): boolean {
  const template = renderTemplate(name, readFileSync(join(TEMPLATES, name), "utf8"), workdir);

  if (existsSync(dest) && readFileSync(dest, "utf8") === template) {
    return false;
  }

  write(dest, template, mode);
  return true;
}

function envTemplate(): string {
  for (const candidate of [".env.example", join("server", ".env.example")]) {
    const path = join(PLUGIN_ROOT, candidate);
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
  }

  return "VK_TOKEN=\nPORT=6060\nLOG_LEVEL=info\n";
}

/** Re-runnable: every file but the `.env` is rewritten from the plugin on each run. */
export function runSetup(argv: string[]): void {
  const workdir = resolveWorkdir(argv);

  if (!existsSync(TEMPLATES)) {
    console.error(`error: templates not found at ${TEMPLATES}`);
    process.exit(1);
  }

  console.log(`claude-vk ${pluginVersion()}`);
  console.log(`\nsession workdir: ${workdir}`);

  let changed = false;
  for (const { name, dest, mode } of installedFiles(workdir)) {
    const written = install(name, dest, workdir, mode);
    changed ||= written;
    console.log(`  ${written ? "wrote    " : "unchanged"}  ${dest}`);
  }

  console.log(`\nchannel config: ${channelDir}`);
  mkdirSync(channelDir, { recursive: true });

  const envExists = existsSync(envPath);
  if (!envExists) {
    write(envPath, envTemplate(), 0o600);
  }
  console.log(`  ${envExists ? "kept     " : "wrote    "}  ${envPath}`);

  if (hasCommand("crontab")) {
    console.log(
      installCron(workdir)
        ? "\nscheduled: respawn every 5 min, fresh context every 6h"
        : "\ncould not edit the crontab; add the lines from the README by hand",
    );
  }

  if (!envExists) {
    console.log("\nstill to do:");
    console.log(`  1. put the VK community token in ${envPath}`);
    console.log(`  2. cd ${workdir} && claude   ->   /login, then /plugin install vk@claude-vk`);
    console.log(`  3. ${respawnPath(workdir)}`);
    console.log("\nthe bot DMs a pairing code on first inbound message; finish with /vk:access.");
    return;
  }

  if (changed || !sessionRunning()) {
    console.log("\nstart or restart the session:");
    console.log(`  tmux kill-session -t ${SESSION} 2>/dev/null; ${respawnPath(workdir)}`);
  }
}
