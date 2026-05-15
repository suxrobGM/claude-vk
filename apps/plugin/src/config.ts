import { validateEnv } from "@/env";

export type Config = {
  port: number;
  httpBind: string;
  transport: "longpoll" | "callback";
  locale: string;
  permissionRelay: boolean;
  stateDir: string | undefined;
  vkToken: string | undefined;
  vkCommunityId: string | undefined;
  vkCommunityScreenName: string | undefined;
  webhookSecret: string | undefined;
};

function build(): Config {
  validateEnv();
  return {
    port: Number(process.env.VK_PORT!),
    httpBind: process.env.VK_HTTP_BIND!,
    transport: process.env.VK_TRANSPORT! as "longpoll" | "callback",
    locale: process.env.VK_LOCALE!,
    permissionRelay: process.env.VK_PERMISSION_RELAY === "true",
    stateDir: process.env.VK_STATE_DIR,
    vkToken: process.env.VK_TOKEN,
    vkCommunityId: process.env.VK_COMMUNITY_ID,
    vkCommunityScreenName: process.env.VK_COMMUNITY_SCREEN_NAME,
    webhookSecret: process.env.VK_WEBHOOK_SECRET,
  };
}

let currentConfig: Config = build();

/**
 * Always call at use-time. Never capture the returned value at module load —
 * M1 introduces .env hot-reload and any captured reference will go stale.
 */
export function current(): Config {
  return currentConfig;
}

export function reload(): void {
  currentConfig = build();
}
