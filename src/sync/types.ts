// Types shared by the PiAPI -> MCP sync task.
//
// The source is a versioned PiAPI API contract in the PiAPI Manager GitHub
// repository. Apidog is intentionally not part of this integration.

/** A single input parameter of a PiAPI model/task_type contract. */
export interface CatalogParam {
  name: string;
  type: string;
  required: boolean;
  enum?: (string | number)[];
  description?: string;
}

/** One PiAPI capability, keyed by `${model}::${task_type}`. */
export interface CatalogEntry {
  key: string;
  model: string;
  taskType: string;
  description?: string;
  params: CatalogParam[];
}

/** A normalized snapshot of the PiAPI task surface. */
export interface PiapiCatalog {
  generatedAt: string;
  source: string;
  entries: Record<string, CatalogEntry>;
}

export type ChangeKind =
  | "added"
  | "removed"
  | "params_changed"
  | "meta_changed"; // description changed

export interface CatalogChange {
  kind: ChangeKind;
  key: string;
  model: string;
  taskType: string;
  details: string[];
}

export interface DiffResult {
  changes: CatalogChange[];
  counts: Record<ChangeKind, number>;
  hasChanges: boolean;
}

export interface OpenApiFetcher {
  id: string;
  fetch(): Promise<OpenApiDocument>;
}

// Minimal structural typing for the OpenAPI shape the normalizer consumes.
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
  const?: unknown;
  [k: string]: unknown;
}
