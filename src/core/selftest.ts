import assert from "node:assert/strict";
import { createPiapiTaskClient } from "./piapi-task.js";
import { mediaKindForOutputField, PIAPI_MEDIA_PROFILE_VERSION } from "./media-profile.js";
import { mediaMimeType, normalizePiapiMediaResult } from "./media-result.js";

assert.equal(PIAPI_MEDIA_PROFILE_VERSION, "2026-09-17");
assert.equal(mediaKindForOutputField("video"), "video");
assert.equal(mediaKindForOutputField("resource_without_watermark", "video"), "video");
assert.equal(mediaKindForOutputField("resource", "cover"), "image");
assert.equal(mediaKindForOutputField("url"), undefined);

const media = normalizePiapiMediaResult("task-1", "3", {
  image_urls: ["https://cdn.piapi.ai/a.png"],
  video_raw: { url: "https://cdn.piapi.ai/v.mp4" },
  last_frame: { url: "https://cdn.piapi.ai/v.jpg" },
  clips: { one: { audio_url: "https://cdn.piapi.ai/a.mp3", image_url: "https://cdn.piapi.ai/cover.jpg" } },
  model_file: "https://cdn.piapi.ai/model.glb",
});
assert.deepEqual(media.assets.map((asset) => asset.kind), ["image", "video", "image", "audio", "image", "model"]);
assert.equal(mediaMimeType(media.assets.find((asset) => asset.kind === "model")!), "model/gltf-binary");
assert.equal(media.assets.find((asset) => asset.kind === "video")?.previewUrl, "https://cdn.piapi.ai/v.jpg");
assert.equal(media.assets.find((asset) => asset.kind === "audio")?.previewUrl, "https://cdn.piapi.ai/cover.jpg");
assert.equal(normalizePiapiMediaResult("task-2", undefined, { url: "https://untyped.example/out" }).assets.length, 0);
const managerMedia = normalizePiapiMediaResult("task-2a", undefined, {
  video: "https://cdn.piapi.ai/kling.mp4",
  works: [{
    video: {
      resource: "https://cdn.piapi.ai/kling-watermarked.mp4",
      resource_without_watermark: "https://cdn.piapi.ai/kling-raw.mp4",
    },
    cover: { resource: "https://cdn.piapi.ai/kling-cover.jpg" },
    image: { resource: "https://cdn.piapi.ai/kling-image.jpg" },
    audio: { resource: "https://cdn.piapi.ai/kling-audio.mp3" },
  }],
});
assert.deepEqual(managerMedia.assets.map((asset) => `${asset.kind}:${asset.url}`), [
  "video:https://cdn.piapi.ai/kling.mp4",
  "video:https://cdn.piapi.ai/kling-watermarked.mp4",
  "video:https://cdn.piapi.ai/kling-raw.mp4",
  "image:https://cdn.piapi.ai/kling-cover.jpg",
  "image:https://cdn.piapi.ai/kling-image.jpg",
  "audio:https://cdn.piapi.ai/kling-audio.mp3",
]);
const expiringMedia = normalizePiapiMediaResult("task-2b", undefined, {
  image_url: "https://cdn.piapi.ai/image.png?Expires=1790000000",
  video_url: "https://cdn.piapi.ai/video.mp4?X-Amz-Date=20260917T000000Z&X-Amz-Expires=3600",
});
assert.equal(expiringMedia.assets[0]?.expiresAt, "2026-09-21T14:13:20.000Z");
assert.equal(expiringMedia.assets[1]?.expiresAt, "2026-09-17T01:00:00.000Z");

const responses = [
  { code: 200, data: { task_id: "task-3" } },
  { code: 200, data: { status: "in_progress" } },
  { code: 200, data: { status: "completed", output: { image_url: "https://cdn.piapi.ai/final.png" }, meta: { usage: { consume: 9 } } } },
];
const client = createPiapiTaskClient({
  apiKey: "test-key",
  fetchImpl: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
  sleep: async () => {},
});
const result = await client.runTask(
  { model: "demo", task_type: "image", input: {} },
  { maxAttempts: 3, timeout: 1 },
  { debug() {}, info() {}, error() {} }
);
assert.equal(result.taskId, "task-3");
assert.equal(result.usage, "9");
assert.deepEqual(result.output, { image_url: "https://cdn.piapi.ai/final.png" });

console.log("core self-test: PASS");
