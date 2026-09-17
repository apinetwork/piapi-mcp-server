/** Normalized media output that is safe to expose to a UI resource. */

import { mediaKindForOutputField, type PiapiMediaKind } from "./media-profile.js";

export type { PiapiMediaKind } from "./media-profile.js";

export interface PiapiMediaAsset {
  kind: PiapiMediaKind;
  url: string;
  previewUrl?: string;
  format?: "glb" | "obj" | "unknown";
}

export interface PiapiMediaResult {
  taskId: string;
  usage?: string;
  assets: PiapiMediaAsset[];
  viewerUrl?: string;
}

export function normalizePiapiMediaResult(
  taskId: string,
  usage: string | undefined,
  output: unknown,
  viewerUrl?: string
): PiapiMediaResult {
  const assets: PiapiMediaAsset[] = [];
  const seen = new Set<string>();
  const add = (kind: PiapiMediaKind, value: unknown, previewUrl?: string) => {
    for (const url of urlsFrom(value)) {
      const key = `${kind}:${url}`;
      const safePreviewUrl = previewUrl && isSafeUrl(previewUrl) ? previewUrl : undefined;
      if (seen.has(key)) {
        const existing = assets.find((asset) => `${asset.kind}:${asset.url}` === key);
        if (existing && safePreviewUrl && !existing.previewUrl) existing.previewUrl = safePreviewUrl;
        continue;
      }
      seen.add(key);
      assets.push({
        kind,
        url,
        ...(safePreviewUrl ? { previewUrl: safePreviewUrl } : {}),
        ...(kind === "model" ? { format: modelFormat(url) } : {}),
      });
    }
  };

  walk(output, (key, value, parent, parentKey) => {
    const knownKind = mediaKindForOutputField(key, parentKey);
    if (knownKind) add(knownKind, value);
    else if (key === "url" && isRecord(parent)) {
      // Provider-specific nested objects often use names such as video_raw,
      // last_frame, or clip. The parent key is available to classify safely.
      if (parentKey === "video_raw") add("video", value);
      else if (parentKey === "last_frame") add("image", value);
    }
  });

  // Carry known companion artifacts into the UI without hiding them from the
  // standard asset list: a Luma last frame can become a video poster, and a
  // music clip's image can become its audio cover. Unknown URL fields remain
  // text-only rather than being guessed as media.
  if (isRecord(output)) {
    add("video", output.video_raw, firstUrl(output.last_frame));
    if (isRecord(output.clips)) {
      for (const clip of Object.values(output.clips)) {
        if (isRecord(clip)) add("audio", clip.audio_url, firstUrl(clip.image_url));
      }
    }
  }

  return { taskId, ...(usage ? { usage } : {}), assets, ...(viewerUrl ? { viewerUrl } : {}) };

}

export function mediaResultText(result: PiapiMediaResult): string {
  const heading = `TaskId: ${result.taskId}${result.usage ? `\nUsage: ${result.usage} tokens` : ""}`;
  if (!result.assets.length) return `${heading}\nPiAPI task completed. Output is available in the structured result.`;
  const lines = result.assets.map((asset, index) => `${index + 1}. ${asset.kind}: ${asset.url}`);
  return `${heading}\nGenerated media:\n${lines.join("\n")}`;
}

export function mediaMimeType(asset: PiapiMediaAsset): string {
  const ext = extension(asset.url);
  if (asset.kind === "image") return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  if (asset.kind === "video") return ext === "webm" ? "video/webm" : "video/mp4";
  if (asset.kind === "audio") return ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/mpeg";
  if (ext === "glb") return "model/gltf-binary";
  if (ext === "obj") return "model/obj";
  return "application/octet-stream";
}

function walk(
  value: unknown,
  visit: (key: string, value: unknown, parent: Record<string, unknown>, parentKey?: string) => void,
  parentKey?: string
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, parentKey);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child, value, parentKey);
    walk(child, visit, key);
  }
}

function firstUrl(value: unknown): string | undefined {
  return urlsFrom(value)[0];
}

function urlsFrom(value: unknown): string[] {
  if (typeof value === "string") return isSafeUrl(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(urlsFrom);
  if (isRecord(value) && typeof value.url === "string") return urlsFrom(value.url);
  return [];
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function extension(url: string): string {
  try {
    return new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

function modelFormat(url: string): "glb" | "obj" | "unknown" {
  const ext = extension(url);
  return ext === "glb" || ext === "obj" ? ext : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
