#!/usr/bin/env node
// PiAPI -> MCP sync CLI.
//
// This is the "periodic/repeatable task" the MCP maintainers run (locally or in
// CI) to keep the MCP tool definitions aligned with the upstream PiAPI surface.
//
// Subcommands:
//   snapshot            Fetch upstream, print a normalized catalog to stdout.
//   diff [--file f]     Fetch upstream, diff against committed baseline, print
//                       a Markdown report. Exit code 0 = in sync, 2 = drift,
//                       1 = error. (CI uses exit 2 to open an issue.)
//   accept [--file f]   Fetch upstream and overwrite the committed baseline.
//                       Run this after you've updated src/index.ts to match.
//   report-file <path>  Like `diff` but also writes the report to <path>.
//
// Source selection (see fetchers.ts):
//   default: PiAPI Manager GitHub Postman contract
//   --file <openapi.json> or PIAPI_SYNC_SOURCE=file  (offline override)

import { writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { getFetcher } from "./fetchers.js";
import { normalize } from "./normalize.js";
import { diffCatalogs, renderReport } from "./diff.js";
import { loadBaseline, saveBaseline, emptyBaseline, BASELINE_PATH } from "./catalog.js";
import type { PiapiCatalog } from "./types.js";

config();

interface Args {
  cmd: string;
  file?: string;
  out?: string;
  source?: string;
}

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const args: Args = { cmd };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--file") args.file = rest[++i];
    else if (a === "--out") args.out = rest[++i];
    else if (a === "--source") args.source = rest[++i];
    else if (!args.out && (cmd === "report-file")) args.out = a;
  }
  return args;
}

async function fetchCatalog(args: Args): Promise<PiapiCatalog> {
  const fetcher = getFetcher({ source: args.source, filePath: args.file });
  const doc = await fetcher.fetch();
  const catalog = normalize(doc, fetcher.id);
  const n = Object.keys(catalog.entries).length;
  process.stderr.write(
    `[sync] fetched ${n} (model,task_type) capabilities from ${catalog.source}\n`
  );
  if (n === 0) {
    process.stderr.write(
      "[sync] WARNING: 0 capabilities extracted — the OpenAPI shape may not encode " +
        "model/task_type as enums. Inspect the spec or adjust normalize.ts.\n"
    );
  }
  return catalog;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.cmd) {
    case "snapshot": {
      const cat = await fetchCatalog(args);
      process.stdout.write(JSON.stringify(cat, null, 2) + "\n");
      return 0;
    }

    case "accept": {
      const cat = await fetchCatalog(args);
      await saveBaseline(cat);
      process.stderr.write(`[sync] baseline written to ${BASELINE_PATH}\n`);
      return 0;
    }

    case "diff":
    case "report-file": {
      const current = await fetchCatalog(args);
      const baseline = (await loadBaseline()) ?? emptyBaseline();
      const diff = diffCatalogs(baseline, current);
      const report = renderReport(diff, current);
      if (args.cmd === "report-file") {
        const out = args.out || "sync-report.md";
        await writeFile(out, report + "\n", "utf8");
        process.stderr.write(`[sync] report written to ${out}\n`);
      } else {
        process.stdout.write(report + "\n");
      }
      // Exit 2 signals "drift detected" to CI without being a hard error.
      return diff.hasChanges ? 2 : 0;
    }

    case "help":
    default:
      process.stdout.write(
        [
          "PiAPI -> MCP sync task",
          "",
          "Usage: node dist/sync/cli.js <command> [options]",
          "",
          "Commands:",
          "  snapshot              Print normalized upstream catalog (JSON)",
          "  diff                  Diff upstream vs committed baseline (exit 2 = drift)",
          "  accept                Overwrite committed baseline from upstream",
          "  report-file [path]    Write the Markdown diff report to a file",
          "",
          "Options:",
          "  --source github|file  Override source (default from env)",
          "  --file <openapi.json> Use a local OpenAPI file as source",
          "  --out <path>          Output path for report-file",
          "",
          "Env:",
          "  PIAPI_SYNC_SOURCE     github|file (default github)",
          "  PIAPI_GITHUB_OWNER    PiAPI Manager GitHub owner",
          "  PIAPI_GITHUB_REPO     PiAPI Manager GitHub repository",
          "  PIAPI_GITHUB_PATH     Versioned Postman contract path",
          "  PIAPI_GITHUB_REF      Branch or tag for the contract (default main)",
          "  PIAPI_CONTRACT_GITHUB_TOKEN  Optional contents:read token for a private source repo",
          "  PIAPI_OPENAPI_FILE    Path to OpenAPI json (file source)",
        ].join("\n") + "\n"
      );
      return 0;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[sync] error: ${err?.message || err}\n`);
    process.exit(1);
  });
