/**
 * Generic builder for VK bot keyboards.
 *
 * VK's `messages.send` accepts a JSON-stringified keyboard descriptor
 * (https://dev.vk.com/en/api/bots/development/keyboard). This module exposes a
 * logical shape and stringifies it for the wire — callers stay in object-land
 * and don't have to remember which fields are required at which level.
 *
 * Currently models text buttons only (the click → `message_new` flow). Callback
 * buttons follow a different event path (`message_event` / `messages.sendMessageEventAnswer`)
 * and can be added when we need them.
 *
 * The `P` type parameter is the payload shape — each button can carry a
 * caller-defined object that VK echoes back as a string on the inbound
 * message. Parsing the echoed payload is the caller's job.
 */
export type KeyboardColor = "primary" | "secondary" | "positive" | "negative";

export interface TextButton<P = unknown> {
  type: "text";
  label: string;
  payload?: P;
  color?: KeyboardColor;
}

export type KeyboardButton<P = unknown> = TextButton<P>;

export interface KeyboardOptions<P = unknown> {
  /** Inline keyboards attach to the message instead of pinning to the chat. */
  inline?: boolean;
  /** Non-inline only: hide after the first click. Ignored when inline. */
  one_time?: boolean;
  /** Rows of buttons. VK caps inline keyboards at 6 rows × 5 buttons. */
  buttons: KeyboardButton<P>[][];
}

/**
 * Serialize a logical keyboard to the JSON string `messages.send` expects on
 * its `keyboard` parameter. Button payloads are JSON-stringified per VK's
 * wire format (the payload field is a string, not a nested object).
 */
export function buildKeyboard<P = unknown>(opts: KeyboardOptions<P>): string {
  const buttons = opts.buttons.map((row) =>
    row.map((b) => ({
      action: {
        type: b.type,
        label: b.label,
        ...(b.payload === undefined ? {} : { payload: JSON.stringify(b.payload) }),
      },
      ...(b.color ? { color: b.color } : {}),
    })),
  );

  return JSON.stringify({
    inline: opts.inline ?? false,
    ...(opts.one_time && !opts.inline ? { one_time: true } : {}),
    buttons,
  });
}
