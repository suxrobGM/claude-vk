import { homedir } from "node:os";
import { join } from "node:path";

export const channelDir = join(homedir(), ".claude", "channels", "vk");

export const envPath = join(channelDir, ".env");
export const accessPath = join(channelDir, "access.json");
export const peersPath = join(channelDir, "peers.json");
export const inboxDir = join(channelDir, "inbox");
export const logDir = join(channelDir, "log");
