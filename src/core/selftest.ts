import assert from "node:assert/strict";
import { createPiapiTaskClient } from "./piapi-task.js";
import { mediaMimeType, normalizePiapiMediaResult } from "./media-result.js";

const media = normalizePiapiMediaResult("task-1", "3", {
  image_urls: ["https://cdn.piapi.ai/a.png"],
  video_raw: { url: "https://cdn.piapi.ai/v.mp4" },
  clips: { one: { audio_url: "https://cdn.piapi.ai/a.mp3", image_url: "https://cdn.piapi.ai/cover.jpg" } },
  model_file: "https://cdn.piapi.ai/model.glb",
});
assert.deepEqual(media.assets.map((asset) => asset.kind), ["image", "video", "audio", "image", "model"]);
assert.equal(mediaMimeType(media.assets[4]), "model/gltf-binary");
assert.equal(normalizePiapiMediaResult("task-2", undefined, { url: "https://untyped.example/out" }).assets.length, 0);

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
