// Normalizes a raw OpenAPI document into a PiapiCatalog snapshot.
//
// PiAPI's unified create-task endpoint is `POST /api/v1/task` with body shape:
//   { model: string, task_type: string, input: { ...params } }
// so the diff unit is the (model, task_type) pair and its `input` params.
//
// Upstream (Apidog-exported) specs vary: some encode model/task_type as enums
// or `const`, some split each model into its own path/operation, some inline
// the request schema and some $ref it. This normalizer is defensive: it walks
// every POST operation, resolves local $refs, and extracts whatever
// model/task_type/input info it can find, degrading gracefully.

import type {
  CatalogEntry,
  CatalogParam,
  JsonSchema,
  OpenApiDocument,
  OpenApiOperation,
  PiapiCatalog,
} from "./types.js";

export function normalize(doc: OpenApiDocument, sourceId: string): PiapiCatalog {
  const schemas = doc.components?.schemas ?? {};
  const resolve = makeResolver(schemas);
  const entries: Record<string, CatalogEntry> = {};

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item) continue;
    for (const [method, op] of Object.entries(item)) {
      if (method.toLowerCase() !== "post" || !op) continue;
      for (const entry of extractEntries(path, op as OpenApiOperation, resolve)) {
        // Merge: if two operations describe the same (model, task_type),
        // union their params (first description/price wins).
        const existing = entries[entry.key];
        if (existing) {
          entries[entry.key] = mergeEntries(existing, entry);
        } else {
          entries[entry.key] = entry;
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: `${sourceId}${doc.info?.title ? ` · ${doc.info.title}` : ""}${
      doc.info?.version ? ` v${doc.info.version}` : ""
    }`,
    entries,
  };
}

// ---- extraction ------------------------------------------------------------

type Resolver = (s: JsonSchema | undefined) => JsonSchema | undefined;

function extractEntries(
  path: string,
  op: OpenApiOperation,
  resolve: Resolver
): CatalogEntry[] {
  const bodySchema = resolve(getRequestBodySchema(op));
  if (!bodySchema) return [];

  const props = flattenSchema(bodySchema, resolve).properties ?? {};
  const modelSchema = resolve(props.model);
  const taskTypeSchema = resolve(props.task_type ?? props.taskType);
  const inputSchema = resolve(props.input);

  const models = literalValues(modelSchema);
  const taskTypes = literalValues(taskTypeSchema);

  // Fall back to path/operationId hints when the body doesn't pin model/task_type.
  const modelList = models.length ? models : [inferFromHint(path, op, "model")];
  const taskTypeList = taskTypes.length
    ? taskTypes
    : [inferFromHint(path, op, "task_type")];

  const params = inputSchema
    ? schemaToParams(inputSchema, resolve)
    : // Some specs put params flat on the body (no `input` wrapper).
      schemaToParams(bodySchema, resolve).filter(
        (p) => p.name !== "model" && p.name !== "task_type" && p.name !== "taskType"
      );

  const description = op.summary || op.description || undefined;
  const price = extractPriceHint(op.description) ?? extractPriceHint(description);

  const out: CatalogEntry[] = [];
  for (const model of modelList) {
    for (const taskType of taskTypeList) {
      if (!model && !taskType) continue;
      const key = `${model}::${taskType}`;
      out.push({ key, model, taskType, description, price, params });
    }
  }
  return out;
}

function getRequestBodySchema(op: OpenApiOperation): JsonSchema | undefined {
  const content = op.requestBody?.content;
  if (!content) return undefined;
  // Prefer application/json; else take the first content type with a schema.
  const json = content["application/json"];
  if (json?.schema) return json.schema;
  for (const media of Object.values(content)) {
    if (media?.schema) return media.schema;
  }
  return undefined;
}

/** Turn a property schema into the list of literal values it constrains. */
function literalValues(s: JsonSchema | undefined): string[] {
  if (!s) return [];
  const vals: (string | number)[] = [];
  if (Array.isArray(s.enum)) vals.push(...s.enum);
  // OpenAPI 3.1 `const`, plus Apidog's habit of putting a fixed example.
  if (s.const !== undefined) vals.push(s.const as string | number);
  if (!vals.length && typeof s.default === "string") vals.push(s.default);
  if (!vals.length && typeof s.example === "string") vals.push(s.example);
  return vals.map((v) => String(v)).filter((v) => v.length > 0);
}

function schemaToParams(schema: JsonSchema, resolve: Resolver): CatalogParam[] {
  const flat = flattenSchema(schema, resolve);
  const required = new Set(flat.required ?? []);
  const props = flat.properties ?? {};
  const params: CatalogParam[] = [];
  for (const [name, rawChild] of Object.entries(props)) {
    const child = resolve(rawChild) ?? rawChild;
    params.push({
      name,
      type: child.type ?? inferType(child),
      required: required.has(name),
      enum: child.enum ? [...child.enum] : undefined,
      description: child.description,
    });
  }
  // Stable ordering so diffs are deterministic.
  params.sort((a, b) => a.name.localeCompare(b.name));
  return params;
}

function inferType(s: JsonSchema): string {
  if (s.properties) return "object";
  if (s.items) return "array";
  if (s.enum && s.enum.length) return typeof s.enum[0] === "number" ? "number" : "string";
  return "unknown";
}

/** Merge allOf/oneOf/anyOf branches into a single properties/required view. */
function flattenSchema(schema: JsonSchema, resolve: Resolver): JsonSchema {
  const merged: JsonSchema = {
    type: schema.type,
    description: schema.description,
    properties: { ...(schema.properties ?? {}) },
    required: [...(schema.required ?? [])],
    enum: schema.enum,
    const: schema.const,
    default: schema.default,
    example: schema.example,
    items: schema.items,
  };
  const branches = [
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ];
  for (const rawBranch of branches) {
    const branch = resolve(rawBranch);
    if (!branch) continue;
    const flat = flattenSchema(branch, resolve);
    Object.assign(merged.properties!, flat.properties);
    for (const r of flat.required ?? []) {
      if (!merged.required!.includes(r)) merged.required!.push(r);
    }
    if (!merged.type && flat.type) merged.type = flat.type;
  }
  return merged;
}

function mergeEntries(a: CatalogEntry, b: CatalogEntry): CatalogEntry {
  const byName = new Map<string, CatalogParam>();
  for (const p of a.params) byName.set(p.name, p);
  for (const p of b.params) if (!byName.has(p.name)) byName.set(p.name, p);
  const params = [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
  return {
    ...a,
    description: a.description ?? b.description,
    price: a.price ?? b.price,
    params,
  };
}

// ---- helpers ---------------------------------------------------------------

function makeResolver(schemas: Record<string, JsonSchema>): Resolver {
  const seen = new Set<string>();
  const resolve = (s: JsonSchema | undefined): JsonSchema | undefined => {
    if (!s) return undefined;
    if (!s.$ref) return s;
    const name = s.$ref.split("/").pop()!;
    if (seen.has(name)) return schemas[name]; // guard against cycles
    seen.add(name);
    const target = schemas[name];
    const out = target ? resolve(target) : undefined;
    seen.delete(name);
    return out;
  };
  return resolve;
}

/** Derive a model/task_type guess from path or operationId when not in body. */
function inferFromHint(
  path: string,
  op: OpenApiOperation,
  which: "model" | "task_type"
): string {
  const hint = op.operationId || op.summary || path;
  if (!hint) return "";
  // We can't reliably split a free-form hint into model vs task_type, so we
  // only use it as a coarse identifier for `model`; task_type stays empty.
  return which === "model" ? slug(hint) : "";
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Best-effort price extraction from a description string. PiAPI OpenAPI usually
 * does NOT carry price, so this is opportunistic: it catches "$0.15 / second",
 * "0.3 credits", "X credits per call" style hints when present in the doc text.
 */
export function extractPriceHint(text?: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(
    /(\$?\d+(?:\.\d+)?\s*(?:credits?|tokens?|usd|\/\s*(?:second|s|call|image|video|generation)))/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : undefined;
}
