export interface Verdict {
  behavior: "allow" | "deny";
  request_id: string;
}

/**
 * Parse a verdict from a VK inline-keyboard payload string. Returns null for
 * anything that isn't our verdict shape
 */
export function parsePayloadVerdict(payload: string | undefined): Verdict | null {
  if (!payload) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const obj = parsed as { a?: unknown; r?: unknown; b?: unknown };
  if (obj.a !== "verdict") {
    return null;
  }
  if (typeof obj.r !== "string" || obj.r.length === 0) {
    return null;
  }
  if (obj.b !== "allow" && obj.b !== "deny") {
    return null;
  }
  return { behavior: obj.b, request_id: obj.r };
}
