import { validateEnv } from "@/env";

export type Config = {
  port: number;
  httpBind: string;
  transport: "longpoll" | "callback";
  locale: string;
  permissionRelay: boolean;
  stateDir: string | undefined;
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
