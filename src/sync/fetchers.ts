// API-contract fetchers for the PiAPI -> MCP sync task.
//
// The default source is the versioned Postman collection maintained with PiAPI
// Manager source code in GitHub. This keeps MCP independent of Apidog. The
// collection is transformed into the small OpenAPI subset consumed by the
// existing normalizer; no pricing data is read or emitted.

import { readFile } from "node:fs/promises";
import type { JsonSchema, OpenApiDocument, OpenApiFetcher } from "./types.js";

const DEFAULT_GITHUB_OWNER = "Gocyber-world";
const DEFAULT_GITHUB_REPO = "midjourney-http-v2";
const DEFAULT_GITHUB_PATH = "Go API.postman_collection.json";
const DEFAULT_GITHUB_REF = "main";

export interface FetcherOptions {
  /** github (default) or file (offline OpenAPI JSON). */
  source?: string;
  filePath?: string;
}

/** Fetches PiAPI's checked-in Postman contract from GitHub's raw endpoint. */
export class GitHubPostmanFetcher implements OpenApiFetcher {
  id: string;

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly path: string,
    private readonly ref: string
  ) {
    this.id = `github:${owner}/${repo}@${ref}:${path}`;
  }

  async fetch(): Promise<OpenApiDocument> {
    const encodedPath = this.path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(this.ref)}`;
    const token = process.env.PIAPI_CONTRACT_GITHUB_TOKEN;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "piapi-mcp-sync",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(
        `GitHub Postman contract fetch failed (HTTP ${res.status}); configure PIAPI_CONTRACT_GITHUB_TOKEN with contents:read on the PiAPI Manager repository if the contract is private`
      );
    }
    const response = asRecord(await res.json());
    const content = typeof response?.content === "string" ? response.content.replace(/\n/g, "") : "";
    if (!content || typeof response?.encoding !== "string" || response.encoding.toLowerCase() !== "base64") {
      throw new Error("GitHub Postman contract response did not contain base64 file content");
    }
    let collection: unknown;
    try {
      collection = JSON.parse(Buffer.from(content, "base64").toString("utf8"));
    } catch {
      throw new Error("GitHub Postman contract returned invalid JSON");
    }
    return postmanCollectionToOpenApi(collection);
  }
}

/** Reads a local OpenAPI JSON document for offline development and recovery. */
export class FileOpenApiFetcher implements OpenApiFetcher {
  id = "file";
  constructor(private readonly path: string) {}

  async fetch(): Promise<OpenApiDocument> {
    const raw = await readFile(this.path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    return Array.isArray(record?.item) ? postmanCollectionToOpenApi(parsed) : (parsed as OpenApiDocument);
  }
}

/** Converts only POST /api/v1/task Postman examples into normalizer input. */
export function postmanCollectionToOpenApi(collection: unknown): OpenApiDocument {
  const root = asRecord(collection);
  const info = asRecord(root?.info);
  const paths: OpenApiDocument["paths"] = {};
  let ordinal = 0;

  const visit = (items: unknown[], group: string[]) => {
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const name = typeof record.name === "string" ? record.name : "PiAPI task";
      const nextGroup = [...group, name];
      if (Array.isArray(record.item)) {
        visit(record.item, nextGroup);
        continue;
      }
      const request = asRecord(record.request);
      if (!request || String(request.method ?? "").toUpperCase() !== "POST") continue;
      const rawUrl = postmanUrl(request.url);
      if (!rawUrl.includes("/api/v1/task")) continue;
      const body = asRecord(request.body);
      if (body?.mode !== "raw" || typeof body.raw !== "string") continue;
      let payload: unknown;
      try {
        payload = JSON.parse(body.raw);
      } catch {
        continue;
      }
      const payloadRecord = asRecord(payload);
      const model = payloadRecord?.model;
      const taskType = payloadRecord?.task_type;
      if (typeof model !== "string" || typeof taskType !== "string") continue;
      const input = asRecord(payloadRecord?.input) ?? {};
      const description = nextGroup.join(" / ");
      paths![`/api/v1/task#${ordinal++}`] = {
        post: {
          summary: description,
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "task_type", "input"],
                  properties: {
                    model: { type: "string", enum: [model] },
                    task_type: { type: "string", enum: [taskType] },
                    input: objectExampleSchema(input),
                  },
                },
              },
            },
          },
        },
      };
    }
  };

  visit(Array.isArray(root?.item) ? root.item : [], []);
  return {
    openapi: "3.0.0",
    info: {
      title: typeof info?.name === "string" ? info.name : "PiAPI Postman contract",
      version: "postman",
    },
    paths,
  };
}

function objectExampleSchema(value: Record<string, unknown>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [name, child] of Object.entries(value)) properties[name] = exampleSchema(child);
  return { type: "object", properties };
}

function exampleSchema(value: unknown): JsonSchema {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length ? exampleSchema(value[0]) : { type: "unknown" } };
  }
  if (value === null) return { type: "null" };
  if (typeof value === "object") return objectExampleSchema(value as Record<string, unknown>);
  return { type: typeof value };
}

function postmanUrl(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return typeof record?.raw === "string" ? record.raw : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Chooses GitHub by default; file is a deliberate offline override. */
export function getFetcher(opts: FetcherOptions = {}): OpenApiFetcher {
  const source = opts.source || process.env.PIAPI_SYNC_SOURCE || (opts.filePath ? "file" : "github");
  if (source === "file") {
    const path = opts.filePath || process.env.PIAPI_OPENAPI_FILE;
    if (!path) throw new Error("file source selected but no path given (use --file <openapi.json>)");
    return new FileOpenApiFetcher(path);
  }
  if (source === "github") {
    return new GitHubPostmanFetcher(
      process.env.PIAPI_GITHUB_OWNER || DEFAULT_GITHUB_OWNER,
      process.env.PIAPI_GITHUB_REPO || DEFAULT_GITHUB_REPO,
      process.env.PIAPI_GITHUB_PATH || DEFAULT_GITHUB_PATH,
      process.env.PIAPI_GITHUB_REF || DEFAULT_GITHUB_REF
    );
  }
  throw new Error(`Unknown sync source '${source}' (expected 'github' or 'file')`);
}
