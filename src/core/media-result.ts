/** Normalized media output that is safe to expose to a UI resource. */

export type PiapiMediaKind = "image" | "video" | "audio" | "model";

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

const IMAGE_KEYS = new Set([
  "image_url", "image_urls", "temporary_image_urls", "no_background_image",
  "last_frame", "thumbnail_url", "cover_url",
]);
const VIDEO_KEYS = new Set(["video_url", "video_urls", "video_raw", "combined_video"]);
const AUDIO_KEYS = new Set(["audio_url", "audio_urls"]);
const MODEL_KEYS = new Set(["model_file", "model_file_url", "model_url"]);

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
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push({
        kind,
        url,
        ...(previewUrl && isSafeUrl(previewUrl) ? { previewUrl } : {}),
        ...(kind === "model" ? { format: modelFormat(url) } : {}),
      });
    }
  };

  walk(output, (key, value, parent) => {
    if (IMAGE_KEYS.has(key)) add("image", value);
    else if (VIDEO_KEYS.has(key)) add("video", value);
    else if (AUDIO_KEYS.has(key)) add("audio", value);
    else if (MODEL_KEYS.has(key)) add("model", value);
    else if (key === "url" && isRecord(parent)) {
      // Provider-specific nested objects often use names such as video_raw,
      // last_frame, or clip. The parent key is available to classify safely.
      const parentKey = parent.__piapiParentKey;
      if (parentKey === "video_raw") add("video", value);
      else if (parentKey === "last_frame") add("image", value);
    }
  });

  // A few provider payloads expose music clips as { clips: { id: { audio_url,
  // image_url } } }; the generic walker captures both fields. Unknown URL fields
  // intentionally stay text-only rather than guessing a media type.
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

function walk(value: unknown, visit: (key: string, value: unknown, parent: Record<string, unknown>) => void, parentKey?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, parentKey);
    return;
  }
  if (!isRecord(value)) return;
  const contextualParent = { ...value, __piapiParentKey: parentKey };
  for (const [key, child] of Object.entries(value)) {
    visit(key, child, contextualParent);
    walk(child, visit, key);
  }
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
