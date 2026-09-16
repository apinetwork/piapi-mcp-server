import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { loadBaseline } from "../../src/sync/catalog.js";
import { createPiapiTaskClient, PiapiTaskError } from "../../src/core/piapi-task.js";
import { mediaMimeType, mediaResultText, normalizePiapiMediaResult, type PiapiMediaResult } from "../../src/core/media-result.js";
import { createModernCatalogToolSpecs } from "./catalog.js";
import { MEDIA_GALLERY_URI, mediaDomainsFromEnvironment, mediaGalleryHtml } from "./media-gallery.js";

config();

const apiKey = process.env.PIAPI_API_KEY;
if (!apiKey) {
  process.stderr.write("Error: PIAPI_API_KEY is required for the MCP Apps server\n");
  process.exit(1);
}

const taskClient = createPiapiTaskClient({ apiKey });
const mediaDomains = mediaDomainsFromEnvironment();
const viewerBaseUrl = parseViewerBaseUrl(process.env.PIAPI_MEDIA_VIEWER_BASE_URL);
const taskConfig = { maxAttempts: 180, timeout: 900 };
const resultSchema = z.object({
  taskId: z.string(),
  usage: z.string().optional(),
  assets: z.array(z.object({
    kind: z.enum(["image", "video", "audio", "model"]),
    url: z.url(),
    previewUrl: z.url().optional(),
    format: z.enum(["glb", "obj", "unknown"]).optional(),
  })),
  viewerUrl: z.url().optional(),
});

async function main(): Promise<void> {
  const catalog = await loadBaseline();
  if (!catalog || Object.keys(catalog.entries).length === 0) {
    throw new Error("PiAPI capability baseline is missing or empty");
  }

  const server = new McpServer({ name: "piapi-apps", version: "1.1.0" });
  registerMediaGallery(server);
  registerGenericTaskTool(server);
  for (const spec of createModernCatalogToolSpecs(catalog)) {
    registerAppTool(server, spec.name, {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      outputSchema: resultSchema,
      _meta: { ui: { resourceUri: MEDIA_GALLERY_URI } },
    }, async (input, context) => runTask({ model: spec.model, taskType: spec.taskType, input, context }));
  }

  await server.connect(new StdioServerTransport());
  process.stderr.write(`PiAPI MCP Apps server registered ${Object.keys(catalog.entries).length} catalog tools\n`);
}

function registerMediaGallery(server: McpServer): void {
  registerAppResource(server, "PiAPI Media Gallery", MEDIA_GALLERY_URI, {
    description: "Displays PiAPI image, video, audio, and 3D generation results.",
    _meta: {
      ui: {
        prefersBorder: true,
        csp: { resourceDomains: mediaDomains },
      },
    },
  }, async () => ({
    contents: [{
      uri: MEDIA_GALLERY_URI,
      mimeType: "text/html;profile=mcp-app",
      text: mediaGalleryHtml(mediaDomains),
      _meta: { ui: { prefersBorder: true, csp: { resourceDomains: mediaDomains } } },
    }],
  }));
}

function registerGenericTaskTool(server: McpServer): void {
  registerAppTool(server, "piapi_run_task", {
    title: "Run a PiAPI task",
    description: "Run any PiAPI model/task_type pair and display recognized media outputs inline when the host supports MCP Apps.",
    inputSchema: z.object({
      model: z.string().min(1),
      task_type: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
    }),
    outputSchema: resultSchema,
    _meta: { ui: { resourceUri: MEDIA_GALLERY_URI } },
  }, async ({ model, task_type, input }, context) => runTask({ model, taskType: task_type, input, context }));
}

async function runTask({
  model,
  taskType,
  input,
  context,
}: {
  model: string;
  taskType: string;
  input: Record<string, unknown>;
  context: unknown;
}) {
  try {
    const raw = await taskClient.runTask(
      { model, task_type: taskType, input },
      taskConfig,
      modernLogger,
      async (progress) => {
        // Progress support varies by MCP protocol era and host. The modern SDK
        // context is intentionally opaque, so only forward it when exposed.
        const reporter = (context as { reportProgress?: (value: typeof progress) => Promise<void> }).reportProgress;
        await reporter?.(progress);
      }
    );
    const result = normalizePiapiMediaResult(raw.taskId, raw.usage, raw.output, viewerUrlForTask(raw.taskId));
    return {
      content: [
        { type: "text" as const, text: mediaResultText(result) },
        ...result.assets.map((asset) => ({
          type: "resource_link" as const,
          uri: asset.url,
          name: `PiAPI ${asset.kind} output`,
          mimeType: mediaMimeType(asset),
        })),
      ],
      structuredContent: result,
    };
  } catch (error) {
    const message = error instanceof PiapiTaskError ? error.message : "PiAPI task failed unexpectedly";
    modernLogger.error(message);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const modernLogger = {
  debug: (message: string) => process.stderr.write(`[DEBUG] ${message}\n`),
  info: (message: string) => process.stderr.write(`[INFO] ${message}\n`),
  error: (message: string) => process.stderr.write(`[ERROR] ${message}\n`),
};

function parseViewerBaseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function viewerUrlForTask(taskId: string): string | undefined {
  if (!viewerBaseUrl) return undefined;
  const url = new URL(viewerBaseUrl);
  url.searchParams.set("taskId", taskId);
  return url.href;
}

main().catch((error) => {
  process.stderr.write(`Failed to start PiAPI MCP Apps server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
