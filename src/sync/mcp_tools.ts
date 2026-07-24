// Contract-backed MCP tool definitions.
//
// The committed PiAPI catalog is the source of truth for the Manager surface.
// Creating the specs from it keeps every (model, task_type) capability exposed
// to MCP without maintaining a second hand-written inventory in src/index.ts.

import { z } from "zod";
import type { CatalogEntry, CatalogParam, PiapiCatalog } from "./types.js";

export interface CatalogToolSpec {
  name: string;
  description: string;
  model: string;
  taskType: string;
  parameters: z.AnyZodObject;
}

export function createCatalogToolSpecs(catalog: PiapiCatalog): CatalogToolSpec[] {
  const names = new Set<string>();
  return Object.values(catalog.entries)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => {
      const name = toolName(entry);
      if (names.has(name)) {
        throw new Error(`Catalog tool name collision for ${entry.key}: ${name}`);
      }
      names.add(name);
      return {
        name,
        description: entry.description
          ? `PiAPI ${entry.model} / ${entry.taskType}: ${entry.description}`
          : `PiAPI ${entry.model} / ${entry.taskType}`,
        model: entry.model,
        taskType: entry.taskType,
        parameters: z.object(
          Object.fromEntries(
            entry.params.map((param) => [param.name, parameterSchema(param)])
          )
        ),
      };
    });
}

function toolName(entry: CatalogEntry): string {
  return `piapi_${slug(entry.model)}_${slug(entry.taskType)}`;
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function parameterSchema(param: CatalogParam): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (param.enum?.length) {
    const literals = param.enum.map((value) => z.literal(value));
    schema =
      literals.length === 1
        ? literals[0]
        : z.union(
            literals as unknown as [
              z.ZodTypeAny,
              z.ZodTypeAny,
              ...z.ZodTypeAny[]
            ]
          );
  } else {
    switch (param.type) {
      case "string":
        schema = z.string();
        break;
      case "number":
      case "integer":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = z.array(z.unknown());
        break;
      case "null":
        schema = z.null();
        break;
      case "object":
      case "unknown":
      default:
        schema = z.unknown();
        break;
    }
  }

  if (param.description) schema = schema.describe(param.description);
  return param.required ? schema : schema.optional();
}
