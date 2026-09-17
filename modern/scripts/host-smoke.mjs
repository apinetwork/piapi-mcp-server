import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const mediaUrl = "https://cdn.piapi.ai/mcp-apps-host-smoke.png";
let receivedApiKey;

const mockApi = createServer((request, response) => {
  receivedApiKey = request.headers["x-api-key"];
  response.setHeader("content-type", "application/json");

  if (request.method === "POST" && request.url === "/api/v1/task") {
    response.end(JSON.stringify({ code: 200, data: { task_id: "host-smoke-task" } }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/v1/task/host-smoke-task") {
    response.end(JSON.stringify({
      code: 200,
      data: {
        status: "completed",
        output: { image_url: mediaUrl },
        meta: { usage: { consume: 1 } },
      },
    }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ code: 404, message: "not found" }));
});

await new Promise((resolve, reject) => {
  mockApi.once("error", reject);
  mockApi.listen(0, "127.0.0.1", resolve);
});

const address = mockApi.address();
assert.ok(address && typeof address === "object");
const mockBaseUrl = `http://127.0.0.1:${address.port}/api/v1`;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const entrypoint = fileURLToPath(new URL("../dist/modern/src/index.js", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint],
  cwd: projectRoot,
  env: {
    ...process.env,
    PIAPI_API_KEY: "test-key",
    PIAPI_API_BASE_URL: mockBaseUrl,
  },
  stderr: "pipe",
});

const stderr = [];
transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
const client = new Client({ name: "piapi-apps-stdio-host-smoke", version: "1.0.0" });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const generic = tools.tools.find((tool) => tool.name === "piapi_run_task");
  assert.equal(generic?._meta?.ui?.resourceUri, "ui://piapi/media-gallery");

  const result = await client.callTool({
    name: "piapi_run_task",
    arguments: { model: "demo", task_type: "image", input: { prompt: "host smoke" } },
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.taskId, "host-smoke-task");
  assert.equal(result.content?.filter((entry) => entry.type === "resource_link").length, 1);
  assert.equal(receivedApiKey, "test-key");

  const resource = await client.readResource({ uri: "ui://piapi/media-gallery" });
  assert.equal(resource.contents[0]?.mimeType, "text/html;profile=mcp-app");
} catch (error) {
  const details = stderr.join("").trim();
  throw new Error(`Modern stdio host smoke failed${details ? `:\n${details}` : ""}`, { cause: error });
} finally {
  await client.close().catch(() => {});
  await new Promise((resolve, reject) => mockApi.close((error) => error ? reject(error) : resolve()));
}

console.log("MCP Apps stdio host smoke: PASS");
