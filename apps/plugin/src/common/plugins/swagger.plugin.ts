import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

export const swaggerPlugin = new Elysia({ name: "swagger", prefix: "/api" }).use(
  swagger({
    documentation: {
      info: {
        title: "claude-vk admin API",
        version: "0.1.0",
        description:
          "Local-only HTTP surface for the VK channel plugin. Health probes, webhook " +
          "receiver (when transport=callback), and admin endpoints consumed by the /vk:* skills.",
      },
      tags: [
        { name: "Health", description: "Liveness and readiness probes." },
        { name: "Admin", description: "Read-only and access-control admin endpoints." },
      ],
    },
  }),
);
