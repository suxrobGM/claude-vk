import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { singleton } from "tsyringe";
import { PluginError } from "@/common/errors";
import { logger } from "@/common/logger";
import { inboxDir } from "@/state/paths";
import type { Attachment } from "./inbound.types";

const ALLOWED_HOSTS = [
  ".userapi.com",
  ".vk.com",
  ".vk.me",
  ".vkuserlive.com",
  ".vkuser.net",
  ".vkuserphoto.com",
  ".vk-cdn.net",
];

/**
 * Downloads inbound photos/docs/voice messages into
 * `~/.claude/channels/vk/inbox/<peer_id>/<cmid>/`. Errors don't bubble — a
 * download failure leaves `local_path` unset and Claude still sees the URL
 * via the `<channel>` body. Only VK-CDN hosts are accepted; anything else
 * keeps the URL but isn't downloaded (PRD §16).
 */
@singleton()
export class AttachmentService {
  /**
   * Resolve each allow-listed URL into a local path under `inbox/<peer_id>/<cmid>/`.
   * Returns the input array with `local_path` populated where downloads succeeded.
   */
  async downloadAll(
    attachments: Attachment[],
    peerId: number,
    cmid: number,
  ): Promise<Attachment[]> {
    if (attachments.length === 0) {
      return attachments;
    }

    const dir = join(inboxDir, String(peerId), String(cmid));
    const out: Attachment[] = [];
    let createdDir = false;

    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i]!;
      if (!a.url || !isAllowedHost(a.url)) {
        out.push(a);
        continue;
      }

      try {
        if (!createdDir) {
          await mkdir(dir, { recursive: true });
          createdDir = true;
        }

        const fileName = pickFileName(a, i);
        const localPath = join(dir, fileName);
        const bytes = await fetchBytes(a.url);

        await writeFile(localPath, bytes);
        out.push({ ...a, local_path: localPath });
      } catch (err) {
        logger.warn({ peer_id: peerId, cmid, type: a.type, err }, "attachment download failed");
        out.push(a);
      }
    }
    return out;
  }
}

/** Fetch a URL into bytes. Throws {@link PluginError} on non-2xx responses. */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new PluginError("attachment_fetch_failed", `HTTP ${res.status} fetching ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** True iff the host is a known VK CDN. */
export function isAllowedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOSTS.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

function pickFileName(a: Attachment, idx: number): string {
  let ext = "bin";
  try {
    const path = new URL(a.url!).pathname;
    const dot = path.lastIndexOf(".");
    if (dot >= 0 && dot < path.length - 1) {
      const candidate = path
        .slice(dot + 1)
        .split("/")[0]!
        .split("?")[0]!;
      if (/^[a-z0-9]{1,8}$/i.test(candidate)) ext = candidate.toLowerCase();
    }
  } catch {
    // fall through to default
  }
  return `${String(idx).padStart(2, "0")}_${a.type}.${ext}`;
}
