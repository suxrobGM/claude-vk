import { buildKeyboard } from "@/vk/keyboard";

/**
 * Inline Allow/Deny buttons for a permission prompt.
 *
 * Each button's payload carries a stable `{ a: "verdict", r, b }` shape so the
 * inbound side can recognize a click without heuristics. VK caps `payload` at
 * 255 chars on the wire; ours is well under.
 */
export type VerdictBehavior = "allow" | "deny";

export interface VerdictButtonPayload {
  a: "verdict";
  r: string;
  b: VerdictBehavior;
}

export function buildVerdictKeyboard(requestId: string): string {
  return buildKeyboard<VerdictButtonPayload>({
    inline: true,
    buttons: [
      [
        {
          type: "text",
          label: "Allow",
          color: "positive",
          payload: { a: "verdict", r: requestId, b: "allow" },
        },
        {
          type: "text",
          label: "Deny",
          color: "negative",
          payload: { a: "verdict", r: requestId, b: "deny" },
        },
      ],
    ],
  });
}
