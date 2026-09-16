import assert from "node:assert/strict";
import { mediaDomainsFromEnvironment, mediaGalleryHtml, MEDIA_GALLERY_URI } from "./media-gallery.js";
import { createModernCatalogToolSpecs } from "./catalog.js";

assert.equal(MEDIA_GALLERY_URI, "ui://piapi/media-gallery");
assert.deepEqual(mediaDomainsFromEnvironment("https://cdn.piapi.ai,invalid,http://unsafe.example"), ["https://cdn.piapi.ai"]);
const html = mediaGalleryHtml(["https://cdn.piapi.ai"]);
assert.ok(html.includes("ui/notifications/tool-result"));
assert.ok(html.includes("Open / download original"));
assert.ok(!html.includes("PIAPI_API_KEY"));
const specs = createModernCatalogToolSpecs({
  generatedAt: "2026-09-16T00:00:00Z",
  source: "test",
  entries: { "model::task": { key: "model::task", model: "model", taskType: "task", params: [{ name: "prompt", type: "string", required: true }] } },
});
assert.equal(specs[0].name, "piapi_model_task");
assert.equal(specs[0].inputSchema.safeParse({ prompt: "hello" }).success, true);
assert.equal(specs[0].inputSchema.safeParse({}).success, false);
console.log("MCP Apps self-test: PASS");
