/**
 * Versioned PiAPI task-output profile.
 *
 * The committed API catalog models request capabilities only. Manager task
 * results have no single OpenAPI output schema, so the media gallery uses this
 * conservative, field-name based profile rather than guessing from arbitrary
 * URLs in `output`.
 */

export type PiapiMediaKind = "image" | "video" | "audio" | "model";

export const PIAPI_MEDIA_PROFILE_VERSION = "2026-09-17";

const DIRECT_OUTPUT_FIELDS: Record<PiapiMediaKind, ReadonlySet<string>> = {
  image: new Set([
    "image", "image_url", "image_urls", "temporary_image_urls",
    "intermediate_image_urls", "no_background_image", "no_background_images",
    "last_frame", "thumbnail", "thumbnail_url", "cover", "cover_url",
    "discord_image_url",
  ]),
  video: new Set(["video", "video_url", "video_urls", "video_raw", "combined_video"]),
  audio: new Set(["audio", "audio_url", "audio_urls"]),
  model: new Set(["model_file", "model_file_url", "model_url"]),
};

const RESOURCE_PARENT_KINDS: Record<string, PiapiMediaKind> = {
  video: "video",
  audio: "audio",
  image: "image",
  cover: "image",
  thumbnail: "image",
  last_frame: "image",
};

/**
 * Returns a recognized media kind only for known Manager result fields.
 * Unknown URL-looking values must remain in the raw structured result instead
 * of being embedded by the UI.
 */
export function mediaKindForOutputField(field: string, parentField?: string): PiapiMediaKind | undefined {
  for (const [kind, fields] of Object.entries(DIRECT_OUTPUT_FIELDS) as Array<[PiapiMediaKind, ReadonlySet<string>]>) {
    if (fields.has(field)) return kind;
  }

  if ((field === "resource" || field === "resource_without_watermark") && parentField) {
    return RESOURCE_PARENT_KINDS[parentField];
  }
  return undefined;
}
