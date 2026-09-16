import { z } from "zod";
import type { CatalogEntry, CatalogParam, PiapiCatalog } from "../../src/sync/types.js";

export interface ModernCatalogToolSpec {
  name: string;
  title: string;
  description: string;
  model: string;
  taskType: string;
  inputSchema: z.ZodObject<Record<string, z.ZodType>>;
}

export function createModernCatalogToolSpecs(catalog: PiapiCatalog): ModernCatalogToolSpec[] {
  const names = new Set<string>();
  return Object.values(catalog.entries)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => {
      const name = `piapi_${slug(entry.model)}_${slug(entry.taskType)}`;
      if (names.has(name)) throw new Error(`Catalog tool name collision for ${entry.key}: ${name}`);
      names.add(name);
      return {
        name,
        title: `${entry.model} / ${entry.taskType}`,
        description: entry.description
          ? `Generate PiAPI media via ${entry.model} / ${entry.taskType}: ${entry.description}`
          : `Generate PiAPI media via ${entry.model} / ${entry.taskType}`,
        model: entry.model,
        taskType: entry.taskType,
        inputSchema: z.object(Object.fromEntries(entry.params.map((param) => [param.name, parameterSchema(param)]))),
      };
    });
}

function parameterSchema(param: CatalogParam): z.ZodType {
  let schema: z.ZodType;
  if (param.enum?.length && param.enum.every((value): value is string => typeof value === "string")) {
    schema = z.enum(param.enum as [string, ...string[]]);
  } else if (param.enum?.length && param.enum.every((value): value is number => typeof value === "number")) {
    const allowed = new Set(param.enum);
    schema = z.number().refine((value) => allowed.has(value), { message: "Value is not in the PiAPI contract enum" });
  } else {
    switch (param.type) {
      case "string": schema = z.string(); break;
      case "number":
      case "integer": schema = z.number(); break;
      case "boolean": schema = z.boolean(); break;
      case "array": schema = z.array(z.unknown()); break;
      case "null": schema = z.null(); break;
      default: schema = z.unknown();
    }
  }
  if (param.description) schema = schema.describe(param.description);
  return param.required ? schema : schema.optional();
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}
