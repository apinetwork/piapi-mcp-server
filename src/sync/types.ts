// Types shared across the PiAPI -> MCP sync task.
//
// The sync task detects changes in the upstream PiAPI surface (source of truth:
// the PiAPI Apidog project, exported as OpenAPI) and reports them so the MCP
// tool definitions in src/index.ts can be kept up to date.

/** A single input parameter of a PiAPI model/task_type, normalized from OpenAPI. */
export interface CatalogParam {
  name: string;
  type: string; // json-schema "type" (string/number/boolean/object/array/...) or "unknown"
  required: boolean;
  enum?: (string | number)[];
  description?: string;
}

/**
 * One PiAPI "capability" == a (model, task_type) pair. This is the unit the MCP
 * tools wrap, so it is the unit we diff. Key is `${model}::${task_type}`.
 */
export interface CatalogEntry {
  key: string;
  model: string;
  taskType: string;
  description?: string;
  /** Price hint if the upstream doc exposes one (usually absent in OpenAPI). */
  price?: string;
  params: CatalogParam[];
}

/** A normalized snapshot of the whole PiAPI task surface at a point in time. */
export interface PiapiCatalog {
  /** ISO timestamp of when this snapshot was produced. */
  generatedAt: string;
  /** Where the snapshot came from (fetcher id + optional spec version/title). */
  source: string;
  entries: Record<string, CatalogEntry>;
}

export type ChangeKind =
  | "added" // new (model, task_type) -> new MCP tool needed
  | "removed" // (model, task_type) gone upstream -> deprecate MCP tool
  | "params_changed" // param added/removed/type/enum/required changed
  | "meta_changed"; // description and/or price changed

export interface CatalogChange {
  kind: ChangeKind;
  key: string;
  model: string;
  taskType: string;
  /** Human-readable detail lines describing exactly what changed. */
  details: string[];
}

export interface DiffResult {
  changes: CatalogChange[];
  /** convenience counters by kind */
  counts: Record<ChangeKind, number>;
  hasChanges: boolean;
}

/** A fetcher returns a raw OpenAPI (v3) document as a parsed object. */
export interface OpenApiFetcher {
  id: string;
  fetch(): Promise<OpenApiDocument>;
}

// Minimal structural typing for the parts of OpenAPI 3.x we read. We keep this
// loose on purpose: upstream tooling (Apidog) is the schema authority, and we
// only need to walk paths/requestBody/schema.
export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, JsonSchema> };
  [k: string]: unknown;
}

export interface OpenApiPathItem {
  post?: OpenApiOperation;
  [method: string]: OpenApiOperation | undefined;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  requestBody?: {
    content?: Record<string, { schema?: JsonSchema; examples?: unknown }>;
  };
  [k: string]: unknown;
}

export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: (string | number)[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  $ref?: string;
  default?: unknown;
  example?: unknown;
  [k: string]: unknown;
}
