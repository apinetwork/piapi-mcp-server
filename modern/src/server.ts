import { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { loadBaseline } from "../../src/sync/catalog.js";
import type { PiapiCatalog } from "../../src/sync/types.js";
import { createPiapiTaskClient, PiapiTaskClient, PiapiTaskError, type TaskConfig } from "../../src/core/piapi-task.js";
import { mediaMimeType, mediaResultText, normalizePiapiMediaResult } from "../../src/core/media-result.js";
import { createModernCatalogToolSpecs } from "./catalog.js";
import { MEDIA_GALLERY_URI, mediaDomainsFromEnvironment, mediaGalleryHtml } from "./media-gallery.js";

export interface PiapiAppsServerOptions {
  apiKey: string;
  apiBaseUrl?: string;
  catalog?: PiapiCatalog;
  taskClient?: PiapiTaskClient;
  taskConfig?: TaskConfig;
  mediaDomains?: string[];
  viewerBaseUrl?: string;
  logger?: AppsLogger;
}

interface AppsLogger {
  debug(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

const defaultTaskConfig: TaskConfig = { maxAttempts: 180, timeout: 900 };
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

export async function createPiapiAppsServer(options: PiapiAppsServerOptions): Promise<McpServer> {
  if (!options.apiKey && !options.taskClient) throw new Error("PiAPI API key is required");
  const catalog = options.catalog ?? await loadBaseline();
  if (!catalog || Object.keys(catalog.entries).length === 0) {
    throw new Error("PiAPI capability baseline is missing or empty");
  }

  const logger = options.logger ?? defaultLogger;
  const taskClient = options.taskClient ?? createPiapiTaskClient({
    apiKey: options.apiKey,
    ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
  });
  const mediaDomains = options.mediaDomains ?? mediaDomainsFromEnvironment();
  const viewerBaseUrl = parseViewerBaseUrl(options.viewerBaseUrl ?? process.env.PIAPI_MEDIA_VIEWER_BASE_URL);
  const taskConfig = options.taskConfig ?? defaultTaskConfig;
  const server = new McpServer({ name: "piapi-apps", version: "1.1.0" });

  registerMediaGallery(server, mediaDomains);
  registerGenericTaskTool(server, taskClient, taskConfig, viewerBaseUrl, logger);
  for (const spec of createModernCatalogToolSpecs(catalog)) {
    registerAppTool(server, spec.name, {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      outputSchema: resultSchema,
      _meta: { ui: { resourceUri: MEDIA_GALLERY_URI } },
    }, async (input, context) => runTask({
      model: spec.model,
      taskType: spec.taskType,
      input,
      context,
      taskClient,
      taskConfig,
      viewerBaseUrl,
      logger,
    }));
  }

  return server;
}

function registerMediaGallery(server: McpServer, mediaDomains: string[]): void {
  registerAppResource(server, "PiAPI Media Gallery", MEDIA_GALLERY_URI, {
    description: "Displays PiAPI image, video, audio, and 3D generation results.",
    _meta: { ui: { prefersBorder: true, csp: { resourceDomains: mediaDomains } } },
  }, async () => ({
    contents: [{
      uri: MEDIA_GALLERY_URI,
      mimeType: "text/html;profile=mcp-app",
      text: mediaGalleryHtml(mediaDomains),
      _meta: { ui: { prefersBorder: true, csp: { resourceDomains: mediaDomains } } },
    }],
  }));
}

function registerGenericTaskTool(
  server: McpServer,
  taskClient: PiapiTaskClient,
  taskConfig: TaskConfig,
  viewerBaseUrl: URL | undefined,
  logger: AppsLogger
): void {
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
  }, async ({ model, task_type, input }, context) => runTask({
    model,
    taskType: task_type,
    input,
    context,
    taskClient,
    taskConfig,
    viewerBaseUrl,
    logger,
  }));
}

async function runTask({
  model,
  taskType,
  input,
  context,
  taskClient,
  taskConfig,
  viewerBaseUrl,
  logger,
}: {
  model: string;
  taskType: string;
  input: Record<string, unknown>;
  context: unknown;
  taskClient: PiapiTaskClient;
  taskConfig: TaskConfig;
  viewerBaseUrl: URL | undefined;
  logger: AppsLogger;
}) {
  try {
    const raw = await taskClient.runTask(
      { model, task_type: taskType, input },
      taskConfig,
      logger,
      async (progress) => {
        const reporter = (context as { reportProgress?: (value: typeof progress) => Promise<void> }).reportProgress;
        await reporter?.(progress);
      }
    );
    const result = normalizePiapiMediaResult(raw.taskId, raw.usage, raw.output, viewerUrlForTask(viewerBaseUrl, raw.taskId));
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
    logger.error(message);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

function parseViewerBaseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function viewerUrlForTask(viewerBaseUrl: URL | undefined, taskId: string): string | undefined {
  if (!viewerBaseUrl) return undefined;
  const url = new URL(viewerBaseUrl);
  url.searchParams.set("taskId", taskId);
  return url.href;
}

const defaultLogger: AppsLogger = {
  debug: (message) => process.stderr.write(`[DEBUG] ${message}\n`),
  info: (message) => process.stderr.write(`[INFO] ${message}\n`),
  error: (message) => process.stderr.write(`[ERROR] ${message}\n`),
};
