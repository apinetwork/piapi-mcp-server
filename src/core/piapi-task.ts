/**
 * Shared PiAPI task lifecycle used by both the legacy FastMCP entrypoint and
 * the MCP Apps entrypoint. Keep transport/UI concerns outside this module.
 */

export interface TaskConfig {
  maxAttempts: number;
  timeout: number; // seconds
}

export interface TaskLogger {
  debug(message: string): void;
  info(message: string): void;
  warn?(message: string): void;
  error(message: string): void;
}

export interface TaskProgress {
  progress: number;
  total?: number;
}

export interface PiapiTaskResult {
  taskId: string;
  usage: string;
  output: unknown;
}

export interface PiapiTaskClientOptions {
  apiKey: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class PiapiTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiapiTaskError";
  }
}

export class PiapiTaskClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: PiapiTaskClientOptions) {
    if (!options.apiKey) throw new Error("PiAPI API key is required");
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.piapi.ai/api/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async runTask(
    request: Record<string, unknown>,
    config: TaskConfig,
    logger: TaskLogger,
    reportProgress: (progress: TaskProgress) => Promise<void> = async () => {}
  ): Promise<PiapiTaskResult> {
    const taskId = await this.createTask(request);
    logger.info(`Task created with ID: ${taskId}`);
    return this.waitForResult(taskId, config, logger, reportProgress);
  }

  async createTask(request: Record<string, unknown>): Promise<string> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/task`, {
      method: "POST",
      headers: piapiHeaders(this.options.apiKey, true),
      body: JSON.stringify(request),
    });
    const data = await readJson(response, "Task creation");
    if (!isRecord(data) || data.code !== 200 || !isRecord(data.data) || typeof data.data.task_id !== "string") {
      throw new PiapiTaskError(`Task creation failed: ${messageFrom(data)}`);
    }
    return data.data.task_id;
  }

  async waitForResult(
    taskId: string,
    config: TaskConfig,
    logger: TaskLogger,
    reportProgress: (progress: TaskProgress) => Promise<void> = async () => {}
  ): Promise<PiapiTaskResult> {
    const intervalMs = Math.max(1, Math.round((config.timeout * 1000) / config.maxAttempts));
    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      logger.info(`Checking task ${taskId} status (attempt ${attempt + 1}/${config.maxAttempts})...`);
      await reportProgress({ progress: (attempt / config.maxAttempts) * 100, total: 100 });

      const response = await this.fetchImpl(`${this.apiBaseUrl}/task/${encodeURIComponent(taskId)}`, {
        headers: piapiHeaders(this.options.apiKey),
      });
      const data = await readJson(response, `Status check for task ${taskId}`);
      if (!isRecord(data) || data.code !== 200 || !isRecord(data.data)) {
        throw new PiapiTaskError(`TaskId: ${taskId}, Status check failed: ${messageFrom(data)}`);
      }

      const task = data.data;
      const status = typeof task.status === "string" ? task.status : "unknown";
      logger.info(`Task ${taskId} status: ${status}`);
      if (status === "completed") {
        if (task.output === undefined || task.output === null) {
          throw new PiapiTaskError(`TaskId: ${taskId}, Task completed but no output found`);
        }
        const usage = usageFrom(task.meta);
        logger.info(`Task ${taskId} completed successfully. Usage: ${usage}`);
        return { taskId, usage, output: task.output };
      }
      if (status === "failed") {
        const errorMessage = isRecord(task.error) && typeof task.error.message === "string"
          ? task.error.message
          : "Unknown error";
        throw new PiapiTaskError(`TaskId: ${taskId}, Generation failed: ${errorMessage}`);
      }

      if (attempt < config.maxAttempts - 1) await this.sleep(intervalMs);
    }
    throw new PiapiTaskError(`TaskId: ${taskId}, Generation timed out after ${config.timeout} seconds`);
  }
}

export function createPiapiTaskClient(options: PiapiTaskClientOptions): PiapiTaskClient {
  return new PiapiTaskClient(options);
}

async function readJson(response: Response, action: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PiapiTaskError(`${action} failed: PiAPI returned a non-JSON response (${response.status})`);
  }
}

function piapiHeaders(apiKey: string, json = false): Headers {
  const headers = new Headers({ Accept: "application/json" });
  headers.set("X-API-Key", apiKey);
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

function usageFrom(meta: unknown): string {
  if (!isRecord(meta) || !isRecord(meta.usage)) return "unknown";
  const consume = meta.usage.consume;
  return typeof consume === "string" || typeof consume === "number" ? String(consume) : "unknown";
}

function messageFrom(value: unknown): string {
  return isRecord(value) && typeof value.message === "string" ? value.message : "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
