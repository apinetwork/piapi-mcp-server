# PiAPI media result profile

## Why the profile is separate from the input catalog

The committed PiAPI catalog describes valid task inputs: a model, a
`task_type`, and the input parameters. It does not contain a complete,
versioned response schema for every Manager route. Result shapes vary by
provider and include both older fields (for example `video_url`) and newer
structured outputs (for example Kling `works[].video.resource`).

The MCP Apps entry therefore uses the versioned profile in
`src/core/media-profile.ts`. It classifies only known Manager result fields and
only accepts HTTPS URLs. A URL under an unknown field is left in the raw
structured output rather than being injected into the gallery.

## Recognized output shapes

| Kind | Direct fields | Nested Manager resource fields |
| --- | --- | --- |
| Image | `image`, `image_url`, `image_urls`, `temporary_image_urls`, `intermediate_image_urls`, `no_background_image(s)`, `last_frame`, `thumbnail`, `cover`, `discord_image_url` | `image.resource`, `cover.resource`, `thumbnail.resource`, `last_frame.resource` (also their `resource_without_watermark` variants) |
| Video | `video`, `video_url`, `video_urls`, `video_raw`, `combined_video` | `video.resource`, `video.resource_without_watermark` |
| Audio | `audio`, `audio_url`, `audio_urls` | `audio.resource`, `audio.resource_without_watermark` |
| 3D model | `model_file`, `model_file_url`, `model_url` | Not currently declared |

Two display-specific companion rules remain in
`src/core/media-result.ts`:

- Luma `last_frame` is retained as an image and is also used as the
  `video_raw` poster.
- A music clip's `image_url` is retained as an image and is also used as the
  `audio_url` cover.

## Source evidence and maintenance

The field inventory was checked against the PiAPI Manager source on
September 17, 2026:

- Midjourney unified result fields include direct and temporary image URL
  arrays.
- Kling unified outputs include direct `video`/`video_url` as well as
  `works` resources for video, cover, image, and audio.
- Qubico outputs include image/image-list, video, audio, and Trellis
  `combined_video` plus `model_file`.
- Luma documents `video_raw`, `thumbnail`, and `last_frame`.

When a Manager change adds or changes a result field:

1. add a fixture reproducing the public `output` shape in
   `src/core/selftest.ts`;
2. add the conservative field mapping in `src/core/media-profile.ts`;
3. run `npm run test`;
4. update this table and the host compatibility test if the UI contract
   changes.

Avoid broad URL-recursion or filename-only classification. Task output may
contain input echoes, callbacks, provider diagnostics, or non-media links;
only declared result fields are eligible for UI embedding.
