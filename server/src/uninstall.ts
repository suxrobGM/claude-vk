import { existsSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { channelDir } from "@/state/paths";
import {
  hasCommand,
  installedFiles,
  removeCron,
  resolveWorkdir,
  SESSION,
  stopSession,
} from "@/vps";

/** Undoes `setup`. `--all` also removes the channel config, token, access state and logs. */
export function runUninstall(argv: string[]): void {
  const all = argv.includes("--all");
  const workdir = resolveWorkdir(argv);

  if (hasCommand("tmux")) {
    console.log(stopSession() ? `stopped session ${SESSION}` : `no session ${SESSION} running`);
  }

  if (hasCommand("crontab")) {
    console.log(removeCron(workdir) ? "removed the cron schedule" : "could not edit the crontab");
  }

  for (const { dest } of installedFiles(workdir)) {
    if (existsSync(dest)) {
      rmSync(dest);
      console.log(`  removed  ${dest}`);
    }
  }

  // rmdir only succeeds on an empty directory, so a workdir holding anything else is left alone.
  for (const dir of [join(workdir, ".claude"), workdir]) {
    try {
      rmdirSync(dir);
      console.log(`  removed  ${dir}`);
    } catch {
      // not empty, or already gone
    }
  }

  if (all) {
    rmSync(channelDir, { recursive: true, force: true });
    console.log(`  removed  ${channelDir}`);
  } else if (existsSync(channelDir)) {
    console.log(`\nkept ${channelDir} (token, access, peers, logs); pass --all to remove it too`);
  }

  console.log("\nstill to do, if you are done with the bot:");
  console.log("  /plugin uninstall vk@claude-vk");
}
