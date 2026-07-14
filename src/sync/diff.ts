// Diffs two PiapiCatalog snapshots and classifies changes into the four
// categories the task requires:
//   - added:          new (model, task_type)      -> new MCP tool needed
//   - removed:        (model, task_type) gone      -> deprecate MCP tool
//   - params_changed: input params/enum/required/type differ
//   - meta_changed:   description and/or price differ

import type {
  CatalogChange,
  CatalogEntry,
  CatalogParam,
  ChangeKind,
  DiffResult,
  PiapiCatalog,
} from "./types.js";

export function diffCatalogs(
  oldCat: PiapiCatalog,
  newCat: PiapiCatalog
): DiffResult {
  const changes: CatalogChange[] = [];
  const oldKeys = new Set(Object.keys(oldCat.entries));
  const newKeys = new Set(Object.keys(newCat.entries));

  // added
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      const e = newCat.entries[key];
      changes.push({
        kind: "added",
        key,
        model: e.model,
        taskType: e.taskType,
        details: [
          `new capability: model="${e.model}" task_type="${e.taskType}"`,
          ...(e.description ? [`  description: ${e.description}`] : []),
          ...(e.params.length
            ? [`  params: ${e.params.map((p) => p.name).join(", ")}`]
            : []),
        ],
      });
    }
  }

  // removed (deprecated upstream)
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      const e = oldCat.entries[key];
      changes.push({
        kind: "removed",
        key,
        model: e.model,
        taskType: e.taskType,
        details: [
          `capability removed upstream: model="${e.model}" task_type="${e.taskType}"`,
        ],
      });
    }
  }

  // changed (present in both)
  for (const key of newKeys) {
    if (!oldKeys.has(key)) continue;
    const before = oldCat.entries[key];
    const after = newCat.entries[key];

    const metaDetails = diffMeta(before, after);
    if (metaDetails.length) {
      changes.push({
        kind: "meta_changed",
        key,
        model: after.model,
        taskType: after.taskType,
        details: metaDetails,
      });
    }

    const paramDetails = diffParams(before.params, after.params);
    if (paramDetails.length) {
      changes.push({
        kind: "params_changed",
        key,
        model: after.model,
        taskType: after.taskType,
        details: paramDetails,
      });
    }
  }

  const counts: Record<ChangeKind, number> = {
    added: 0,
    removed: 0,
    params_changed: 0,
    meta_changed: 0,
  };
  for (const c of changes) counts[c.kind]++;

  // Deterministic ordering for stable reports.
  changes.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)
  );

  return { changes, counts, hasChanges: changes.length > 0 };
}

function diffMeta(before: CatalogEntry, after: CatalogEntry): string[] {
  const details: string[] = [];
  if ((before.description ?? "") !== (after.description ?? "")) {
    details.push(
      `description changed:`,
      `  - before: ${trunc(before.description)}`,
      `  + after:  ${trunc(after.description)}`
    );
  }
  if ((before.price ?? "") !== (after.price ?? "")) {
    details.push(
      `price changed: ${before.price ?? "(none)"} -> ${after.price ?? "(none)"}`
    );
  }
  return details;
}

function diffParams(before: CatalogParam[], after: CatalogParam[]): string[] {
  const details: string[] = [];
  const beforeMap = new Map(before.map((p) => [p.name, p]));
  const afterMap = new Map(after.map((p) => [p.name, p]));

  for (const [name, p] of afterMap) {
    if (!beforeMap.has(name)) {
      details.push(
        `param added: ${name} (type=${p.type}, required=${p.required}${
          p.enum ? `, enum=[${p.enum.join(",")}]` : ""
        })`
      );
    }
  }
  for (const [name] of beforeMap) {
    if (!afterMap.has(name)) details.push(`param removed: ${name}`);
  }
  for (const [name, a] of afterMap) {
    const b = beforeMap.get(name);
    if (!b) continue;
    if (b.type !== a.type) details.push(`param ${name}: type ${b.type} -> ${a.type}`);
    if (b.required !== a.required)
      details.push(`param ${name}: required ${b.required} -> ${a.required}`);
    const be = JSON.stringify(b.enum ?? null);
    const ae = JSON.stringify(a.enum ?? null);
    if (be !== ae) details.push(`param ${name}: enum ${be} -> ${ae}`);
  }
  return details;
}

function trunc(s?: string, n = 120): string {
  if (!s) return "(none)";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Render a diff as a Markdown changelog for issues / PR bodies / logs. */
export function renderReport(diff: DiffResult, newCat: PiapiCatalog): string {
  const lines: string[] = [];
  lines.push(`# PiAPI → MCP sync report`);
  lines.push("");
  lines.push(`- source: ${newCat.source}`);
  lines.push(`- generated: ${newCat.generatedAt}`);
  lines.push(
    `- summary: ${diff.counts.added} added · ${diff.counts.removed} removed · ` +
      `${diff.counts.params_changed} param-changed · ${diff.counts.meta_changed} desc/price-changed`
  );
  lines.push("");

  if (!diff.hasChanges) {
    lines.push(`No changes detected. MCP tools are in sync with upstream PiAPI.`);
    return lines.join("\n");
  }

  const sections: [ChangeKind, string][] = [
    ["added", "🟢 New APIs (add MCP tools)"],
    ["removed", "🔴 Deprecated APIs (remove/mark MCP tools)"],
    ["params_changed", "🟡 Parameter changes (update tool schemas)"],
    ["meta_changed", "🔵 Description / price changes"],
  ];
  for (const [kind, title] of sections) {
    const items = diff.changes.filter((c) => c.kind === kind);
    if (!items.length) continue;
    lines.push(`## ${title}`);
    for (const c of items) {
      lines.push(`### \`${c.model}\` / \`${c.taskType || "(n/a)"}\``);
      for (const d of c.details) lines.push(d.startsWith("  ") ? d : `- ${d}`);
      lines.push("");
    }
  }
  lines.push(
    `> Action: update the corresponding \`server.addTool(...)\` definitions in ` +
      `\`src/index.ts\` (model name, task_type, and Zod parameter schema), then ` +
      `refresh the committed baseline with \`npm run sync:accept\`.`
  );
  return lines.join("\n");
}
