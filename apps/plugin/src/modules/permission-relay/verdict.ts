/**
 * Verdict regex per PRD §15.1: `y`/`yes`/`n`/`no` followed by a 5-letter id
 * from the lowercase no-`l` alphabet (`a-km-z`). Case-insensitive on the
 * yes/no word; the id is normalized to lowercase by the parser. Anchored on
 * both sides so a bare word "yes" or noise around the id won't match.
 */
export const VERDICT_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

export interface Verdict {
  behavior: "allow" | "deny";
  request_id: string;
}

/**
 * Parse a verdict from message text. Returns null if the message does not
 * structurally match the verdict shape; non-null only when both the prefix
 * and the id pass the regex.
 */
export function parseVerdict(text: string): Verdict | null {
  const m = VERDICT_RE.exec(text);
  if (!m) {
    return null;
  }

  const word = m[1]!.toLowerCase();
  const behavior: "allow" | "deny" = word === "y" || word === "yes" ? "allow" : "deny";
  return { behavior, request_id: m[2]!.toLowerCase() };
}
