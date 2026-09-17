import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createPiapiTaskClient } from "../../src/core/piapi-task.js";
import { apiBaseUrlFromEnvironment, DEFAULT_PIAPI_API_BASE_URL } from "./api-base-url.js";
import { createPiapiAppsServer, viewerBaseUrlFromEnvironment } from "./server.js";
import { mediaDomainsFromEnvironment, mediaGalleryHtml, MEDIA_GALLERY_URI } from "./media-gallery.js";
import { createModernCatalogToolSpecs } from "./catalog.js";

assert.equal(MEDIA_GALLERY_URI, "ui://piapi/media-gallery");
assert.equal(DEFAULT_PIAPI_API_BASE_URL, "https://api.piapi.ai/api/v1");
assert.equal(apiBaseUrlFromEnvironment(undefined), undefined);
assert.equal(apiBaseUrlFromEnvironment("https://api.piapi.ai/api/v1/"), "https://api.piapi.ai/api/v1");
assert.equal(apiBaseUrlFromEnvironment("http://127.0.0.1:4318/api/v1"), "http://127.0.0.1:4318/api/v1");
assert.throws(() => apiBaseUrlFromEnvironment("http://example.com/api/v1"), /HTTPS/);
assert.throws(() => apiBaseUrlFromEnvironment("https://api.piapi.ai/api/v1?unsafe=true"), /query string/);
assert.equal(viewerBaseUrlFromEnvironment("https://viewer.example.com/result")?.href, "https://viewer.example.com/result");
assert.equal(viewerBaseUrlFromEnvironment("http://viewer.example.com/result"), undefined);
assert.equal(viewerBaseUrlFromEnvironment("https://user:pass@viewer.example.com/result"), undefined);
assert.equal(viewerBaseUrlFromEnvironment("https://viewer.example.com/result?url=https%3A%2F%2Fcdn.example"), undefined);
assert.deepEqual(mediaDomainsFromEnvironment("https://cdn.piapi.ai,invalid,http://unsafe.example"), ["https://cdn.piapi.ai"]);
const html = mediaGalleryHtml(["https://cdn.piapi.ai"]);
assert.ok(html.includes("ui/initialize"));
assert.ok(html.includes("Open / download original"));
assert.ok(html.includes("GLTFLoader"));
assert.ok(!html.includes("PIAPI_API_KEY"));
const catalog = {
  generatedAt: "2026-09-16T00:00:00Z",
  source: "test",
  entries: { "model::task": { key: "model::task", model: "model", taskType: "task", params: [{ name: "prompt", type: "string", required: true }] } },
};
const specs = createModernCatalogToolSpecs(catalog);
assert.equal(specs[0].name, "piapi_model_task");
assert.equal(specs[0].inputSchema.safeParse({ prompt: "hello" }).success, true);
assert.equal(specs[0].inputSchema.safeParse({}).success, false);

const responseQueue = [
  { code: 200, data: { task_id: "task-ui-1" } },
  { code: 200, data: {
    status: "completed",
    output: {
      video_raw: { url: "https://cdn.piapi.ai/demo.mp4" },
      last_frame: { url: "https://cdn.piapi.ai/demo.jpg" },
      clips: { song: { audio_url: "https://cdn.piapi.ai/demo.mp3", image_url: "https://cdn.piapi.ai/cover.jpg" } },
      model_file: "https://cdn.piapi.ai/model.glb",
    },
    meta: { usage: { consume: 7 } },
  } },
];
const taskClient = createPiapiTaskClient({
  apiKey: "test-key",
  fetchImpl: async () => new Response(JSON.stringify(responseQueue.shift()), { status: 200 }),
  sleep: async () => {},
});
const server = await createPiapiAppsServer({
  apiKey: "test-key",
  taskClient,
  catalog,
  mediaDomains: ["https://cdn.piapi.ai"],
  viewerBaseUrl: "https://viewer.example.com/result",
  logger: { debug() {}, info() {}, error() {} },
});
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "piapi-apps-test-client", version: "1.0.0" });
await client.connect(clientTransport);
const toolList = await client.listTools();
const generic = toolList.tools.find((tool) => tool.name === "piapi_run_task");
const genericMeta = generic?._meta as { ui?: { resourceUri?: string } } | undefined;
assert.equal(genericMeta?.ui?.resourceUri, MEDIA_GALLERY_URI);
const toolResult = await client.callTool({
  name: "piapi_run_task",
  arguments: { model: "demo", task_type: "media", input: { prompt: "test" } },
});
assert.equal(toolResult.isError, undefined);
const structured = toolResult.structuredContent as {
  taskId?: string;
  assets?: Array<{ kind: string; previewUrl?: string }>;
};
assert.equal(structured.taskId, "task-ui-1");
assert.equal(structured.assets?.length, 5);
assert.equal(structured.assets?.find((asset) => asset.kind === "video")?.previewUrl, "https://cdn.piapi.ai/demo.jpg");
assert.equal(structured.assets?.find((asset) => asset.kind === "audio")?.previewUrl, "https://cdn.piapi.ai/cover.jpg");
assert.equal((toolResult.structuredContent as { viewerUrl?: string }).viewerUrl, "https://viewer.example.com/result?taskId=task-ui-1");
assert.equal(toolResult.content?.filter((entry) => entry.type === "resource_link").length, 5);
const gallery = await client.readResource({ uri: MEDIA_GALLERY_URI });
assert.equal(gallery.contents[0]?.mimeType, "text/html;profile=mcp-app");
const galleryText = "text" in gallery.contents[0] ? gallery.contents[0].text : undefined;
assert.ok(galleryText?.includes("https://cdn.piapi.ai"));
await client.close();
await server.close();

console.log("MCP Apps self-test: PASS");
