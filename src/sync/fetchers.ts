// OpenAPI fetchers for the sync task.
//
// The source of truth for the PiAPI API surface is the PiAPI Apidog project
// (id 675356, team builtopia), which is what powers https://piapi.ai/docs.
// Apidog exposes an Open API `export-openapi` endpoint, but it requires an
// access token with "project maintainer" privilege. We therefore support two
// interchangeable sources so the task can run either fully headless (token) or
// from a spec file exported by other means (e.g. Apidog UI / browser session):
//
//   - ApidogOpenApiFetcher  -> needs APIDOG_ACCESS_TOKEN + APIDOG_PROJECT_ID
//   - FileOpenApiFetcher     -> reads a local OpenAPI json (path via arg/env)
//
// Selection is done by getFetcher() based on env, so ops can flip sources
// without touching the diff engine.

import { readFile } from "node:fs/promises";
import type { OpenApiDocument, OpenApiFetcher } from "./types.js";

const APIDOG_API_BASE = "https://api.apidog.com";
const APIDOG_API_VERSION = "2024-03-28";

export interface FetcherOptions {
  /** Override source: "apidog" | "file". Defaults to auto-detect from env. */
  source?: string;
  /** File path for the file fetcher. */
  filePath?: string;
}

/**
 * Pulls the PiAPI OpenAPI document from Apidog's Open API.
 * Docs: https://docs.apidog.com/openapi (export-openapi).
 */
export class ApidogOpenApiFetcher implements OpenApiFetcher {
  id = "apidog";
  constructor(
    private readonly token: string,
    private readonly projectId: string
  ) {}

  async fetch(): Promise<OpenApiDocument> {
    const url = `${APIDOG_API_BASE}/v1/projects/${this.projectId}/export-openapi?locale=en-US`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-Apidog-Api-Version": APIDOG_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: { type: "ALL" },
        options: { includeApidogExtensionProperties: false },
        oasVersion: "3.0",
        exportFormat: "JSON",
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Apidog export-openapi failed (HTTP ${res.status}): ${text.slice(0, 500)}`
      );
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new Error(
        `Apidog export-openapi returned non-JSON body: ${text.slice(0, 200)}`
      );
    }
    // Apidog may wrap the spec in {data: ...} on some plans; unwrap if needed.
    const maybe = doc as Record<string, unknown>;
    if (maybe && typeof maybe === "object" && "openapi" in maybe) {
      return maybe as OpenApiDocument;
    }
    if (maybe && typeof maybe === "object" && "data" in maybe) {
      return maybe.data as OpenApiDocument;
    }
    return maybe as OpenApiDocument;
  }
}

/** Reads an OpenAPI json from disk (for offline runs / testing / browser export). */
export class FileOpenApiFetcher implements OpenApiFetcher {
  id = "file";
  constructor(private readonly path: string) {}

  async fetch(): Promise<OpenApiDocument> {
    const raw = await readFile(this.path, "utf8");
    return JSON.parse(raw) as OpenApiDocument;
  }
}

/** Chooses a fetcher based on options then env. Throws with actionable guidance. */
export function getFetcher(opts: FetcherOptions = {}): OpenApiFetcher {
  const source =
    opts.source || process.env.PIAPI_SYNC_SOURCE || (opts.filePath ? "file" : "apidog");

  if (source === "file") {
    const path = opts.filePath || process.env.PIAPI_OPENAPI_FILE;
    if (!path) {
      throw new Error(
        "file source selected but no path given (use --file <path> or PIAPI_OPENAPI_FILE)"
      );
    }
    return new FileOpenApiFetcher(path);
  }

  if (source === "apidog") {
    const token = process.env.APIDOG_ACCESS_TOKEN;
    const projectId = process.env.APIDOG_PROJECT_ID || "675356"; // PiAPI project
    if (!token) {
      throw new Error(
        "apidog source needs APIDOG_ACCESS_TOKEN (a maintainer-privilege Apidog access token). " +
          "Set it in .env, or use --file <exported-openapi.json> / PIAPI_SYNC_SOURCE=file for an offline run."
      );
    }
    return new ApidogOpenApiFetcher(token, projectId);
  }

  throw new Error(`Unknown sync source '${source}' (expected 'apidog' or 'file')`);
}
