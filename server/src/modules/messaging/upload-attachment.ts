import { extname } from "node:path";
import { singleton } from "tsyringe";
import { PluginError } from "@/common/errors";
import { logger } from "@/common/logger";
import { runWithEnvelope } from "@/common/utils/tool-envelope";
import { VkClient } from "@/vk/client";
import type { UploadAttachmentInput, UploadAttachmentResult } from "./messaging.schema";

const MAX_BYTES = 50 * 1024 * 1024;
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VOICE_EXTS = new Set([".ogg", ".oga"]);

type UploadKind = "photo" | "doc" | "voice";

/**
 * Upload a local file to VK and return the canonical `photo<owner>_<id>` or
 * `doc<owner>_<id>` reference Claude can splice into a follow-up `send_message`.
 *
 * Flow per VK docs: getMessagesUploadServer → multipart POST → save*. Only the
 * VK-API legs go through `RateLimiter`; the multipart POST hits VK's upload
 * subdomain which is separate from the 20 req/s quota.
 */
@singleton()
export class UploadService {
  constructor(private readonly vk: VkClient) {}

  async upload(input: UploadAttachmentInput): Promise<UploadAttachmentResult> {
    return runWithEnvelope("upload_attachment", async () => {
      const kind = resolveKind(input.kind, input.path);
      const file = Bun.file(input.path);
      if (!(await file.exists())) {
        throw new PluginError("file_not_found", `No file at ${input.path}`);
      }
      if (file.size > MAX_BYTES) {
        throw new PluginError(
          "file_too_large",
          `File exceeds 50 MB (${file.size} bytes): ${input.path}`,
        );
      }

      const ref =
        kind === "photo"
          ? await this.uploadPhoto(input.peer_id, input.path, file)
          : await this.uploadDoc(input.peer_id, input.path, file, kind);

      logger.info({ peer_id: input.peer_id, kind, vk_ref: ref.vk_ref }, "upload_attachment ok");
      return { ok: true, vk_ref: ref.vk_ref } as const;
    });
  }

  private async uploadPhoto(peerId: number, path: string, file: ReturnType<typeof Bun.file>) {
    const server = await this.vk.getPhotoUploadServer({ peer_id: peerId });
    const uploaded = (await postFile(server.upload_url, path, file)) as {
      photo: string;
      server: number;
      hash: string;
    };
    return this.vk.saveMessagesPhoto({
      photo: uploaded.photo,
      server: uploaded.server,
      hash: uploaded.hash,
    });
  }

  private async uploadDoc(
    peerId: number,
    path: string,
    file: ReturnType<typeof Bun.file>,
    kind: "doc" | "voice",
  ) {
    const server = await this.vk.getDocUploadServer({
      peer_id: peerId,
      type: kind === "voice" ? "audio_message" : "doc",
    });
    const uploaded = (await postFile(server.upload_url, path, file)) as { file: string };
    return this.vk.saveDoc({ file: uploaded.file });
  }
}

function resolveKind(declared: UploadKind | "auto", path: string): UploadKind {
  if (declared !== "auto") return declared;
  const ext = extname(path).toLowerCase();
  if (PHOTO_EXTS.has(ext)) return "photo";
  if (VOICE_EXTS.has(ext)) return "voice";
  return "doc";
}

async function postFile(
  url: string,
  path: string,
  file: ReturnType<typeof Bun.file>,
): Promise<unknown> {
  const form = new FormData();
  // VK expects field name "photo" for photo upload servers and "file" for doc
  // upload servers, but in practice both accept either. Use "file" universally;
  // VK's response shape disambiguates.
  form.append("file", file, basename(path));
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    throw new PluginError(
      "upload_failed",
      `VK upload server returned HTTP ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as unknown;
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
