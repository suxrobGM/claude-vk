import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SESSION = "vk";

/**
 * The plugin root holds `deploy/` and `.claude-plugin/`. Source runs from `server/src`, the
 * built bundle from `dist/`, so walk up to the manifest rather than assuming a depth.
 */
export function pluginRoot(): string {
  let dir = import.meta.dir;

  for (let up = 0; up < 5; up += 1) {
    if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }

  return resolve(import.meta.dir, "..");
}

/** The first non-flag argument, or the default session directory. */
export function resolveWorkdir(argv: string[]): string {
  return resolve(argv.find((arg) => !arg.startsWith("--")) ?? join(homedir(), "bots", SESSION));
}

export function respawnPath(workdir: string): string {
  return join(workdir, "respawn.sh");
}

export interface InstalledFile {
  /** Name under the plugin's `deploy/` directory. */
  name: string;
  dest: string;
  mode?: number;
}

/** The files the plugin owns in a session workdir: `setup` writes them, `uninstall` removes them. */
export function installedFiles(workdir: string): InstalledFile[] {
  return [
    { name: "respawn.sh", dest: respawnPath(workdir), mode: 0o755 },
    { name: "CLAUDE.md", dest: join(workdir, "CLAUDE.md") },
    { name: "settings.json", dest: join(workdir, ".claude", "settings.json") },
  ];
}

/** respawn.sh ships a runnable default, so the installed copy is pointed at the real workdir. */
export function renderTemplate(name: string, template: string, workdir: string): string {
  if (name !== "respawn.sh") {
    return template;
  }

  return template
    .replace(/^session=.*$/m, `session=${SESSION}`)
    .replace(/^workdir=.*$/m, `workdir=${workdir}`);
}

function run(cmd: string[], stdin?: string): { ok: boolean; stdout: string } {
  try {
    const result = Bun.spawnSync(cmd, {
      stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { ok: result.exitCode === 0, stdout: new TextDecoder().decode(result.stdout) };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/** cron and tmux are absent on a dev machine, so every caller degrades to a printed hint. */
export function hasCommand(name: string): boolean {
  return run(["sh", "-c", `command -v ${name}`]).ok;
}

function cronLines(workdir: string): string[] {
  const respawn = respawnPath(workdir);
  return [
    `*/5 * * * * ${respawn}`,
    `0 */6 * * * tmux kill-session -t ${SESSION} 2>/dev/null; ${respawn}`,
  ];
}

function currentCrontab(): string[] {
  // A user with no crontab exits non-zero, which is not an error here.
  const { ok, stdout } = run(["crontab", "-l"]);
  return ok ? stdout.split("\n").filter((line) => line.trim() !== "") : [];
}

function writeCrontab(lines: string[]): boolean {
  return run(["crontab", "-"], `${lines.join("\n")}\n`).ok;
}

/** Replaces any earlier entry for the same directory. */
export function installCron(workdir: string): boolean {
  const respawn = respawnPath(workdir);
  const kept = currentCrontab().filter((line) => !line.includes(respawn));
  return writeCrontab([...kept, ...cronLines(workdir)]);
}

export function removeCron(workdir: string): boolean {
  const respawn = respawnPath(workdir);
  const current = currentCrontab();
  const kept = current.filter((line) => !line.includes(respawn));

  if (kept.length === current.length) {
    return true;
  }
  return writeCrontab(kept);
}

export function stopSession(): boolean {
  return run(["tmux", "kill-session", "-t", SESSION]).ok;
}

export function sessionRunning(): boolean {
  return run(["tmux", "has-session", "-t", SESSION]).ok;
}
