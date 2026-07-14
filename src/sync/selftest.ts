// Offline self-test for the sync engine (no network / no Apidog token needed).
//
// Feeds two hand-built OpenAPI fixtures through normalize() + diffCatalogs() and
// asserts each of the four change categories is detected. Run: npm run test:sync
// Exits non-zero on any failed assertion so it can gate CI/build.

import { normalize } from "./normalize.js";
import { diffCatalogs } from "./diff.js";
import type { OpenApiDocument } from "./types.js";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    process.stdout.write(`  ok  - ${msg}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL- ${msg}\n`);
  }
}

// A minimal PiAPI-shaped create-task operation for a given model/task_type.
function op(
  model: string,
  taskType: string,
  input: Record<string, any>,
  required: string[] = [],
  description = ""
) {
  return {
    post: {
      summary: description || `${model} ${taskType}`,
      description,
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
  openapi: "3.0.0",
  info: { title: "PiAPI", version: "1" },
  paths: {
    "/api/v1/task#flux": op(
      "Qubico/flux1-schnell",
      "txt2img",
      {
        prompt: { type: "string", description: "the prompt" },
        width: { type: "number" },
      },
      ["prompt"],
      "Generate an image with Flux. $0.01 / image"
    ),
    "/api/v1/task#kling": op("kling", "video_generation", {
      prompt: { type: "string" },
      duration: { type: "number", enum: [5, 10] },
    }),
    "/api/v1/task#old": op("Qubico/legacy", "deprecated_task", {
      foo: { type: "string" },
    }),
  },
};

const AFTER: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "PiAPI", version: "2" },
  paths: {
    // meta_changed: description + price changed
    "/api/v1/task#flux": op(
      "Qubico/flux1-schnell",
      "txt2img",
      {
        prompt: { type: "string", description: "the prompt" },
        width: { type: "number" },
      },
      ["prompt"],
      "Generate a high-quality image with Flux. $0.02 / image"
    ),
    // params_changed: added `cfg`, enum on duration changed
    "/api/v1/task#kling": op("kling", "video_generation", {
      prompt: { type: "string" },
      duration: { type: "number", enum: [5, 10, 15] },
      cfg: { type: "number" },
    }),
    // old one removed (deprecated)
    // added: brand-new model
    "/api/v1/task#new": op("Qubico/newmodel", "txt2video", {
      prompt: { type: "string" },
    }),
  },
};

process.stdout.write("sync engine self-test\n");

const before = normalize(BEFORE, "fixture");
const after = normalize(AFTER, "fixture");

assert(
  Object.keys(before.entries).length === 3,
  `normalize before -> 3 entries (got ${Object.keys(before.entries).length})`
);
assert(
  !!before.entries["Qubico/flux1-schnell::txt2img"],
  "entry keyed by model::task_type"
);
assert(
  before.entries["Qubico/flux1-schnell::txt2img"].params.some(
    (p) => p.name === "prompt" && p.required
  ),
  "required param captured from input.required"
);
assert(
  before.entries["Qubico/flux1-schnell::txt2img"].price === "$0.01 / image",
  `price hint extracted (got ${before.entries["Qubico/flux1-schnell::txt2img"].price})`
);

const diff = diffCatalogs(before, after);

assert(diff.counts.added === 1, `1 added (got ${diff.counts.added})`);
assert(diff.counts.removed === 1, `1 removed (got ${diff.counts.removed})`);
assert(
  diff.counts.params_changed === 1,
  `1 params_changed (got ${diff.counts.params_changed})`
);
assert(
  diff.counts.meta_changed === 1,
  `1 meta_changed (got ${diff.counts.meta_changed})`
);

const added = diff.changes.find((c) => c.kind === "added");
assert(added?.model === "Qubico/newmodel", "added change points to new model");

const removed = diff.changes.find((c) => c.kind === "removed");
assert(removed?.model === "Qubico/legacy", "removed change points to legacy model");

const paramsChanged = diff.changes.find((c) => c.kind === "params_changed");
assert(
  !!paramsChanged?.details.some((d) => d.includes("cfg")),
  "params_changed reports the new `cfg` param"
);
assert(
  !!paramsChanged?.details.some((d) => d.includes("enum")),
  "params_changed reports the duration enum change"
);

const meta = diff.changes.find((c) => c.kind === "meta_changed");
assert(
  !!meta?.details.some((d) => d.toLowerCase().includes("price")),
  "meta_changed reports the price change"
);

process.stdout.write(
  failures === 0
    ? "\nALL PASS\n"
    : `\n${failures} ASSERTION(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
