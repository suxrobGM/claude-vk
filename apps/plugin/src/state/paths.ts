import { homedir } from "node:os";
import { join } from "node:path";

const root = process.env.VK_STATE_DIR ?? join(homedir(), ".claude", "channels", "vk");

export const stateDir = root;
export const envPath = join(root, ".env");
export const accessPath = join(root, "access.json");
export const peersPath = join(root, "peers.json");
export const statePath = join(root, "state.json");
export const inboxDir = join(root, "inbox");
export const logDir = join(root, "log");
