// Baseline catalog persistence: load/save the committed snapshot that the sync
// task diffs against. The baseline lives at src/sync/baseline.piapi-catalog.json
// and IS committed to the repo, so drift detection is reproducible in CI.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiapiCatalog } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve back to the repo source path even when running from dist/.
export const BASELINE_PATH = resolveBaselinePath();

function resolveBaselinePath(): string {
  // dist/sync/catalog.js -> ../../src/sync/baseline...
  // src/sync/catalog.ts  -> ./baseline...
  const candidates = [
    resolve(__dirname, "baseline.piapi-catalog.json"),
    resolve(__dirname, "../../src/sync/baseline.piapi-catalog.json"),
    // The isolated MCP Apps package compiles shared sources under
    // modern/dist/src/, so its generated catalog module is two levels deeper
    // than the legacy dist/sync/ layout.
    resolve(__dirname, "../../../../src/sync/baseline.piapi-catalog.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1];
}

export async function loadBaseline(path = BASELINE_PATH): Promise<PiapiCatalog | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as PiapiCatalog;
}

export async function saveBaseline(
  catalog: PiapiCatalog,
  path = BASELINE_PATH
): Promise<void> {
  await writeFile(path, JSON.stringify(catalog, null, 2) + "\n", "utf8");
}

export function emptyBaseline(): PiapiCatalog {
  return { generatedAt: new Date(0).toISOString(), source: "empty", entries: {} };
}
