import { config } from "dotenv";
import { FastMCP, imageContent, UserError } from "fastmcp";
import { z } from "zod";
// Load environment variables
config();

if (!process.env.PIAPI_API_KEY) {
  console.error("Error: PIAPI API key not set");
  process.exit(1);
}

const apiKey: string = process.env.PIAPI_API_KEY;

const server = new FastMCP({
  name: "piapi",
  version: "1.0.0",
});

// Register tools
registerGeneralTool(server);
registerFluxTool(server);
registerHunyuanTool(server);
registerWanTool(server);

// Start the server
async function main() {
  try {
    await server.start({
      transportType: "stdio",
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

// Tool Definitions

function registerGeneralTool(server: FastMCP) {
  server.addTool({
    name: "show_image",
    description: "Show an image",
    parameters: z.object({
      url: z.string().url().describe("The URL of the image to show"),
    }),
    execute: async (args) => {
      return imageContent({ url: args.url });
    },
  });
}

interface BaseConfig {
  maxAttempts: number;
  timeout: number; // in seconds
}

interface FluxConfig extends BaseConfig {
  defaultSteps: number;
  maxSteps: number;
}

const FLUX_MODEL_CONFIG: Record<string, FluxConfig> = {
  schnell: { defaultSteps: 4, maxSteps: 10, maxAttempts: 30, timeout: 60 },
  dev: { defaultSteps: 25, maxSteps: 40, maxAttempts: 30, timeout: 120 },
};

function registerFluxTool(server: FastMCP) {
  server.addTool({
    name: "generate_image",
    description: "Generate a image using PiAPI Flux",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate an image from"),
      negative_prompt: z
        .string()
        .describe("The negative prompt to generate an image from")
        .optional()
        .default("chaos, bad photo, low quality, low resolution"),
      width: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .pipe(z.number().min(128).max(1024))
        .optional()
        .default(1024)
        .describe(
          "The width of the image to generate, must be between 128 and 1024, defaults to 1024"
        ),
      height: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .pipe(z.number().min(128).max(1024))
        .optional()
        .default(1024)
        .describe(
          "The height of the image to generate, must be between 128 and 1024, defaults to 1024"
        ),
      steps: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .optional()
        .default(0)
        .describe("The number of steps to generate the image"),
      lora: z
        .enum(["", "mystic-realism", "ob3d-isometric-3d-room", "remes-abstract-poster-style", "paper-quilling-and-layering-style"])
        .optional()
        .default("")
        .describe(
          "The lora to use for image generation, only available for 'dev' model, defaults to ''"
        ),
      model: z
        .enum(["schnell", "dev"])
        .optional()
        .default("schnell")
        .describe(
          "The model to use for image generation, 'schnell' is faster and cheaper but less detailed, 'dev' is slower but more detailed"
        ),
    }),
    execute: async (args, { log }) => {
      // Create image generation task
      const config = FLUX_MODEL_CONFIG[args.model];
      let steps = args.steps || config.defaultSteps;
      steps = Math.min(steps, config.maxSteps);

      let requestBody = "";
      if (args.lora !== "") {
        requestBody = JSON.stringify({
          model: "Qubico/flux1-dev-advanced",
          task_type: "txt2img-lora",
          input: {
            prompt: args.prompt,
            negative_prompt: args.negative_prompt,
            width: args.width,
            height: args.height,
            steps: steps,
            "lora_settings": [
              {
                "lora_type": args.lora,
              }
            ]
          },
        });
      } else {
        requestBody = JSON.stringify({
          model:
            args.model === "schnell"
              ? "Qubico/flux1-schnell"
              : "Qubico/flux1-dev",
          task_type: "txt2img",
          input: {
            prompt: args.prompt,
            negative_prompt: args.negative_prompt,
            width: args.width,
            height: args.height,
            steps: steps,
          },
        });
      }

      const { usage, output } = await handleTask(log, requestBody, config);

      const urls = parseImageOutput(output);
      return {
        content: [
          {
            type: "text",
            text: `Image generated successfully!\nUsage: ${usage} tokens\nImage urls:\n${urls.join(
              "\n"
            )}`,
          },
        ],
      };
    },
  });
}

const HUNYUAN_MODEL_CONFIG: Record<string, BaseConfig> = {
  hunyuan: { maxAttempts: 60, timeout: 900 },
  fastHunyuan: { maxAttempts: 60, timeout: 600 },
};

function registerHunyuanTool(server: FastMCP) {
  server.addTool({
    name: "generate_video_hunyuan",
    description: "Generate a video using PiAPI Hunyuan",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate a video from"),
      negative_prompt: z
        .string()
        .describe("The negative prompt to generate a video from")
        .optional()
        .default("chaos, bad video, low quality, low resolution"),
      aspect_ratio: z
        .enum(["16:9", "1:1", "9:16"])
        .optional()
        .default("16:9")
        .describe(
          "The aspect ratio of the video to generate, must be either '16:9', '1:1', or '9:16', defaults to '16:9'"
        ),
      model: z
        .enum(["hunyuan", "fastHunyuan"])
        .optional()
        .default("hunyuan")
        .describe(
          "The model to use for video generation, must be either 'hunyuan' or 'fastHunyuan', 'hunyuan' is slower but more detailed, 'fastHunyuan' is faster but less detailed"
        ),
    }),
    execute: async (args, { log }) => {
      // Create video generation task
      const config = HUNYUAN_MODEL_CONFIG[args.model];

      const requestBody = JSON.stringify({
        model: "Qubico/hunyuan",
        task_type: args.model === "hunyuan" ? "txt2video" : "fast-txt2video",
        input: {
          prompt: args.prompt,
          negative_prompt: args.negative_prompt,
          aspect_ratio: args.aspect_ratio,
        },
      });
      const { usage, output } = await handleTask(log, requestBody, config);

      const url = parseVideoOutput(output);
      return {
        content: [
          {
            type: "text",
            text: `Video generated successfully!\nUsage: ${usage} tokens\nVideo url:\n${url}`,
          },
        ],
      };
    },
  });
}

const WAN_MODEL_CONFIG: Record<string, BaseConfig> = {
  wan1_3b: { maxAttempts: 30, timeout: 300 },
  wan14b: { maxAttempts: 60, timeout: 900 },
};

function registerWanTool(server: FastMCP) {
  server.addTool({
    name: "generate_video_wan",
    description: "Generate a video using PiAPI Wan",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate a video from"),
      negative_prompt: z
        .string()
        .describe("The negative prompt to generate a video from")
        .optional()
        .default("chaos, bad video, low quality, low resolution"),
      aspect_ratio: z
        .enum(["16:9", "1:1", "9:16"])
        .optional()
        .default("16:9")
        .describe(
          "The aspect ratio of the video to generate, must be either '16:9', '1:1', or '9:16', defaults to '16:9'"
        ),
      model: z
        .enum(["wan1_3b", "wan14b"])
        .optional()
        .default("wan1_3b")
        .describe(
          "The model to use for video generation, must be either 'wan1_3b' or 'wan14b', 'wan1_3b' is faster but less detailed, 'wan14b' is slower but more detailed"
        ),
    }),
    execute: async (args, { log }) => {
      // Create video generation task
      const config = WAN_MODEL_CONFIG[args.model];

      const requestBody = JSON.stringify({
        model: "Qubico/wanx",
        task_type: args.model === "wan1_3b" ? "txt2video-1.3b" : "txt2video-14b",
        input: {
          prompt: args.prompt,
          negative_prompt: args.negative_prompt,
          aspect_ratio: args.aspect_ratio,
        },
      });
      const { usage, output } = await handleTask(log, requestBody, config);

      const url = parseVideoOutput(output);
      return {
        content: [
          {
            type: "text",
            text: `Video generated successfully!\nUsage: ${usage} tokens\nVideo url:\n${url}`,
          },
        ],
      };
    },
  });
}

// Task handler
async function handleTask(log: any, requestBody: string, config: BaseConfig) {
  const taskId = await createTask(requestBody);
  log.info(`Task created with ID: ${taskId}`);
  return await getTaskResult(log, taskId, config.maxAttempts, config.timeout);
}

async function createTask(requestBody: string) {
  const createResponse = await fetch("https://api.piapi.ai/api/v1/task", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  const createData = await createResponse.json();

  if (createData.code !== 200) {
    throw new UserError(`Task creation failed: ${createData.message}`);
  }

  return createData.data.task_id;
}

async function getTaskResult(
  log: any,
  taskId: string,
  maxAttempts: number,
  timeout: number
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    log.info(`Checking task status (attempt ${attempt + 1})...`);

    const statusResponse = await fetch(
      `https://api.piapi.ai/api/v1/task/${taskId}`,
      {
        headers: {
          "X-API-Key": apiKey,
        },
      }
    );

    const statusData = await statusResponse.json();

    if (statusData.code !== 200) {
      throw new UserError(`Status check failed: ${statusData.message}`);
    }

    const { status, output, error } = statusData.data;

    log.info(`Task status: ${status}`);

    if (status === "completed") {
      if (!output) {
        throw new UserError("Task completed but no output found");
      }
      const usage = statusData.data.meta.usage?.consume || "unknown";

      return { usage, output };
    }

    if (status === "failed") {
      throw new UserError(`Generation failed: ${error.message}`);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, (timeout * 1000) / maxAttempts)
    );
  }

  throw new UserError(`Generation timed out after ${timeout} seconds`);
}

// Result parser

const ImageOutputSchema = z
  .object({
    image_url: z.string().optional(),
    image_urls: z.array(z.string()).optional(),
  })
  .refine(
    (data) => data.image_url || (data.image_urls && data.image_urls.length > 0),
    {
      message: "At least one image URL must be provided",
      path: ["image_url", "image_urls"],
    }
  );

function parseImageOutput(output: unknown): string[] {
  const result = ImageOutputSchema.safeParse(output);

  if (!result.success) {
    throw new UserError(`Invalid image output format: ${result.error.message}`);
  }

  const imageOutput = result.data;
  const image_urls = [
    ...(imageOutput.image_url ? [imageOutput.image_url] : []),
    ...(imageOutput.image_urls || []),
  ].filter(Boolean);

  if (image_urls.length === 0) {
    throw new UserError("Task completed but no image URLs found");
  }

  return image_urls;
}

const VideoOutputSchema = z
  .object({
    video_url: z.string().optional(),
  })
  .refine((data) => data.video_url, {
    message: "At least one video URL must be provided",
    path: ["video_url"],
  });

function parseVideoOutput(output: unknown): string {
  const result = VideoOutputSchema.safeParse(output);

  if (!result.success) {
    throw new UserError(`Invalid video output format: ${result.error.message}`);
  }

  const video_url = result.data.video_url;

  if (!video_url) {
    throw new UserError("Task completed but no video URL found");
  }

  return video_url;
}
