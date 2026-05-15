const DEFAULT_MAX = 4096;
const WHITESPACE_LOOKBACK = 100;

/**
 * Splits `text` into UTF-16-length-bounded chunks suitable for VK's per-message
 * cap (4096 chars). Prefers the last whitespace within the trailing 100 chars
 * of each chunk to avoid mid-word breaks; falls back to a hard split when no
 * whitespace is reachable. Empty input yields an empty array — callers should
 * already have rejected zero-length sends upstream.
 */
export function chunkText(text: string, max: number = DEFAULT_MAX): string[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length <= max) {
    return [text];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= max) {
      chunks.push(text.slice(cursor));
      break;
    }
    let cut = cursor + max;
    const searchStart = Math.max(cursor, cut - WHITESPACE_LOOKBACK);
    const window = text.slice(searchStart, cut);
    const wsIdx = window.search(/\s\S*$/);
    if (wsIdx > 0) cut = searchStart + wsIdx;
    chunks.push(text.slice(cursor, cut));
    cursor = cut;
    while (cursor < text.length && /\s/.test(text[cursor]!)) cursor++;
  }
  return chunks;
}
