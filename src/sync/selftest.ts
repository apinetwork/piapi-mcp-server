// Offline self-test for the sync engine (no network or credentials required).

import { postmanCollectionToOpenApi } from "./fetchers.js";
import { normalize } from "./normalize.js";
import { diffCatalogs } from "./diff.js";
import type { JsonSchema, OpenApiDocument } from "./types.js";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) process.stdout.write(`  ok  - ${msg}\n`);
  else { failures++; process.stdout.write(`  FAIL- ${msg}\n`); }
}

function op(model: string, taskType: string, input: Record<string, JsonSchema>, required: string[] = [], description = ""): NonNullable<OpenApiDocument["paths"]>[string] {
  return {
    post: {
      summary: description || `${model} ${taskType}`,
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                model: { type: "string", enum: [model] },
                task_type: { type: "string", enum: [taskType] },
                input: { type: "object", required, properties: input },
              },
            },
          },
        },
      },
    },
  };
}

const BEFORE: OpenApiDocument = {
  openapi: "3.0.0", info: { title: "PiAPI", version: "1" }, paths: {
    "/api/v1/task#flux": op("Qubico/flux1-schnell", "txt2img", { prompt: { type: "string" }, width: { type: "number" } }, ["prompt"], "Generate Flux image"),
    "/api/v1/task#kling": op("kling", "video_generation", { prompt: { type: "string" }, duration: { type: "number", enum: [5, 10] } }),
    "/api/v1/task#old": op("Qubico/legacy", "deprecated_task", { foo: { type: "string" } }),
  },
};
const AFTER: OpenApiDocument = {
  openapi: "3.0.0", info: { title: "PiAPI", version: "2" }, paths: {
    "/api/v1/task#flux": op("Qubico/flux1-schnell", "txt2img", { prompt: { type: "string" }, width: { type: "number" } }, ["prompt"], "Generate high-quality Flux image"),
    "/api/v1/task#kling": op("kling", "video_generation", { prompt: { type: "string" }, duration: { type: "number", enum: [5, 10, 15] }, cfg: { type: "number" } }),
    "/api/v1/task#new": op("Qubico/newmodel", "txt2video", { prompt: { type: "string" } }),
  },
};

const POSTMAN = {
  info: { name: "PiAPI API" }, item: [{ name: "Unified", item: [{ name: "Flux", request: {
    method: "POST", url: { raw: "{{base_manager_url}}/api/v1/task" }, body: { mode: "raw", raw: JSON.stringify({
      model: "Qubico/flux1-schnell", task_type: "txt2img", input: { prompt: "a bear", width: 512, enabled: true },
    }) },
  } }]}],
};

process.stdout.write("sync engine self-test\n");
const before = normalize(BEFORE, "fixture");
const after = normalize(AFTER, "fixture");
assert(Object.keys(before.entries).length === 3, "normalize before -> 3 entries");
assert(before.entries["Qubico/flux1-schnell::txt2img"].params.some((p) => p.name === "prompt" && p.required), "required parameter captured");
const diff = diffCatalogs(before, after);
assert(diff.counts.added === 1, "detects one added API");
assert(diff.counts.removed === 1, "detects one removed API");
assert(diff.counts.params_changed === 1, "detects one parameter change");
assert(diff.counts.meta_changed === 1, "detects one description change");
assert(!JSON.stringify(diff).toLowerCase().includes("price"), "pricing is not represented in the sync result");

const postmanCatalog = normalize(postmanCollectionToOpenApi(POSTMAN), "postman-fixture");
const postmanEntry = postmanCatalog.entries["Qubico/flux1-schnell::txt2img"];
assert(!!postmanEntry, "GitHub/Postman contract creates a PiAPI capability");
assert(postmanEntry?.params.some((p) => p.name === "width" && p.type === "number"), "Postman example infers numeric input parameter");
assert(postmanEntry?.params.some((p) => p.name === "enabled" && p.type === "boolean"), "Postman example infers boolean input parameter");

process.stdout.write(failures === 0 ? "\nALL PASS\n" : `\n${failures} ASSERTION(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
