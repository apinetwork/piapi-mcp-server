import { config } from "dotenv";
import { FastMCP, imageContent, Progress, UserError } from "fastmcp";
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
    description:
      "Show an image with pixels less than 768*1024 due to Claude limitation",
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
  inpaint: { defaultSteps: 25, maxSteps: 40, maxAttempts: 30, timeout: 120 },
  outpaint: { defaultSteps: 25, maxSteps: 40, maxAttempts: 30, timeout: 120 },
  variation: { defaultSteps: 25, maxSteps: 40, maxAttempts: 30, timeout: 120 },
  controlnet: { defaultSteps: 25, maxSteps: 40, maxAttempts: 30, timeout: 180 },
};

function registerFluxTool(server: FastMCP) {
  server.addTool({
    name: "generate_image",
    description: "Generate a image using PiAPI Flux",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate an image from"),
      negativePrompt: z
        .string()
        .optional()
        .default("chaos, bad photo, low quality, low resolution")
        .describe("The negative prompt to generate an image from"),
      referenceImage: z
        .string()
        .url()
        .optional()
        .describe(
          "The reference image to generate an image from, must be a valid image url"
        ),
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
        .enum([
          "",
          "mystic-realism",
          "ob3d-isometric-3d-room",
          "remes-abstract-poster-style",
          "paper-quilling-and-layering-style",
        ])
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
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.prompt) {
        throw new UserError("Prompt is required");
      }
      const config = FLUX_MODEL_CONFIG[args.model];
      let steps = args.steps || config.defaultSteps;
      steps = Math.min(steps, config.maxSteps);

      let requestBody = "";
      if (args.lora !== "") {
        requestBody = JSON.stringify({
          model: "Qubico/flux1-dev-advanced",
          task_type: args.referenceImage ? "img2img-lora" : "txt2img-lora",
          input: {
            prompt: args.prompt,
            negative_prompt: args.negativePrompt,
            image: args.referenceImage,
            width: args.width,
            height: args.height,
            steps: steps,
            lora_settings: [
              {
                lora_type: args.lora,
              },
            ],
          },
        });
      } else {
        requestBody = JSON.stringify({
          model:
            args.model === "schnell"
              ? "Qubico/flux1-schnell"
              : "Qubico/flux1-dev",
          task_type: args.referenceImage ? "img2img" : "txt2img",
          input: {
            prompt: args.prompt,
            negative_prompt: args.negativePrompt,
            image: args.referenceImage,
            width: args.width,
            height: args.height,
            steps: steps,
          },
        });
      }

      const { usage, output } = await handleTask(log, reportProgress, requestBody, config);

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
  server.addTool({
    name: "modify_image",
    description: "Modify a image using PiAPI Flux, inpaint or outpaint",
    parameters: z.object({
      prompt: z.string().describe("The prompt to modify an image from"),
      negativePrompt: z
        .string()
        .optional()
        .default("chaos, bad photo, low quality, low resolution")
        .describe("The negative prompt to modify an image from"),
      referenceImage: z
        .string()
        .url()
        .describe(
          "The reference image to modify an image from, must be a valid image url"
        ),
      paddingLeft: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .optional()
        .default(0)
        .describe("The padding left of the image, only available for outpaint"),
      paddingRight: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .optional()
        .default(0)
        .describe(
          "The padding right of the image, only available for outpaint"
        ),
      paddingTop: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .optional()
        .default(0)
        .describe("The padding top of the image, only available for outpaint"),
      paddingBottom: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .optional()
        .default(0)
        .describe(
          "The padding bottom of the image, only available for outpaint"
        ),
      steps: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseInt(val) : val))
        .optional()
        .default(0)
        .describe("The number of steps to generate the image"),
      model: z
        .enum(["inpaint", "outpaint"])
        .describe("The model to use for image modification"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.prompt) {
        throw new UserError("Prompt is required");
      } else if (!args.referenceImage) {
        throw new UserError("Reference image is required");
      }
      const config = FLUX_MODEL_CONFIG[args.model];
      let steps = args.steps || config.defaultSteps;
      steps = Math.min(steps, config.maxSteps);

      let requestBody = "";
      if (args.model === "inpaint") {
        requestBody = JSON.stringify({
          model: "Qubico/flux1-dev-advanced",
          task_type: "fill-inpaint",
          input: {
            prompt: args.prompt,
            negative_prompt: args.negativePrompt,
            image: args.referenceImage,
            steps: steps,
          },
        });
      } else {
        requestBody = JSON.stringify({
          model: "Qubico/flux1-dev-advanced",
          task_type: "fill-outpaint",
          input: {
            prompt: args.prompt,
            negative_prompt: args.negativePrompt,
            image: args.referenceImage,
            steps: steps,
            custom_settings: [
              {
                setting_type: "outpaint",
                outpaint_left: args.paddingLeft,
                outpaint_right: args.paddingRight,
                outpaint_top: args.paddingTop,
                outpaint_bottom: args.paddingBottom,
              },
            ],
          },
        });
      }

      const { usage, output } = await handleTask(log, reportProgress, requestBody, config);

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
  server.addTool({
    name: "derive_image",
    description: "Derive a image using PiAPI Flux, variation",
    parameters: z.object({
      prompt: z.string().describe("The prompt to derive an image from"),
      negativePrompt: z
        .string()
        .optional()
        .default("chaos, bad photo, low quality, low resolution")
        .describe("The negative prompt to derive an image from"),
      referenceImage: z
        .string()
        .url()
        .describe(
          "The reference image to derive an image from, must be a valid image url"
        ),
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
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.prompt) {
        throw new UserError("Prompt is required");
      } else if (!args.referenceImage) {
        throw new UserError("Reference image is required");
      }
      const config = FLUX_MODEL_CONFIG["variation"];
      let steps = args.steps || config.defaultSteps;
      steps = Math.min(steps, config.maxSteps);

      let requestBody = JSON.stringify({
        model: "Qubico/flux1-dev-advanced",
        task_type: "redux-variation",
        input: {
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          image: args.referenceImage,
          width: args.width,
          height: args.height,
          steps: steps,
        },
      });

      const { usage, output } = await handleTask(log, reportProgress, requestBody, config);

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
  server.addTool({
    name: "generate_image_controlnet",
    description: "Generate a image using PiAPI Flux with ControlNet",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate an image from"),
      negativePrompt: z
        .string()
        .optional()
        .default("chaos, bad photo, low quality, low resolution")
        .describe("The negative prompt to generate an image from"),
      referenceImage: z
        .string()
        .url()
        .describe(
          "The reference image to generate an image from, must be a valid image url"
        ),
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
        .enum([
          "",
          "mystic-realism",
          "ob3d-isometric-3d-room",
          "remes-abstract-poster-style",
          "paper-quilling-and-layering-style",
        ])
        .optional()
        .default("")
        .describe("The lora to use for image generation"),
      controlType: z
        .enum(["depth", "canny", "hed", "openpose"])
        .optional()
        .default("depth")
        .describe("The control type to use for image generation"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.prompt) {
        throw new UserError("Prompt is required");
      } else if (!args.referenceImage) {
        throw new UserError("Reference image is required");
      }
      const config = FLUX_MODEL_CONFIG["controlnet"];
      let steps = args.steps || config.defaultSteps;
      steps = Math.min(steps, config.maxSteps);

      let requestBody = JSON.stringify({
        model: "Qubico/flux1-dev-advanced",
        task_type: "controlnet-lora",
        input: {
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          width: args.width,
          height: args.height,
          steps: steps,
          lora_settings: args.lora !== "" ? [{ lora_type: args.lora }] : [],
          control_net_settings: [
            {
              control_type: args.controlType,
              control_image: args.referenceImage,
            },
          ],
        },
      });

      const { usage, output } = await handleTask(log, reportProgress, requestBody, config);

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

interface HunyuanConfig extends BaseConfig {
  taskType: string;
}

const HUNYUAN_MODEL_CONFIG: Record<string, HunyuanConfig> = {
  hunyuan: { maxAttempts: 60, timeout: 900, taskType: "txt2video" },
  fastHunyuan: { maxAttempts: 60, timeout: 600, taskType: "fast-txt2video" },
  hunyuanConcat: { maxAttempts: 60, timeout: 900, taskType: "img2video-concat" },
  hunyuanReplace: { maxAttempts: 60, timeout: 900, taskType: "img2video-replace" },
};

function registerHunyuanTool(server: FastMCP) {
  server.addTool({
    name: "generate_video_hunyuan",
    description: "Generate a video using PiAPI Hunyuan",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate a video from"),
      negativePrompt: z
        .string()
        .describe("The negative prompt to generate a video from")
        .optional()
        .default("chaos, bad video, low quality, low resolution"),
      referenceImage: z
        .string()
        .url()
        .optional()
        .describe(
          "The reference image to generate a video from, must be a valid image url"
        ),
      aspectRatio: z
        .enum(["16:9", "1:1", "9:16"])
        .optional()
        .default("16:9")
        .describe(
          "The aspect ratio of the video to generate, must be either '16:9', '1:1', or '9:16', defaults to '16:9'"
        ),
      model: z
        .enum(["hunyuan", "fastHunyuan", "hunyuanConcat", "hunyuanReplace"])
        .optional()
        .default("hunyuan")
        .describe(
          "The model to use for video generation, 'hunyuan' is slower but more detailed, 'fastHunyuan' is faster but less detailed, both for txt2video. 'hunyuanReplace' sticks to reference image, and 'hunyuanConcat' allows for more creative movement, both for img2video"
        ),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create video generation task
      if (!args.prompt) {
        throw new UserError("Prompt is required");
      }
      if (args.referenceImage && (args.model === "hunyuan" || args.model === "fastHunyuan")) {
        log.warn("Reference image is not supported for 'hunyuan' or 'fastHunyuan' model, using 'hunyuanConcat' as default");
        args.model = "hunyuanConcat";
      }
      const config = HUNYUAN_MODEL_CONFIG[args.model];

      const requestBody = JSON.stringify({
        model: "Qubico/hunyuan",
        task_type: config.taskType,
        input: {
          image: args.referenceImage,
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          aspect_ratio: args.aspectRatio,
        },
      });
      const { usage, output } = await handleTask(log, reportProgress, requestBody, config);

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
      negativePrompt: z
        .string()
        .describe("The negative prompt to generate a video from")
        .optional()
        .default("chaos, bad video, low quality, low resolution"),
      aspectRatio: z
        .enum(["16:9", "1:1", "9:16"])
        .optional()
        .default("16:9")
        .describe(
          "The aspect ratio of the video to generate, must be either '16:9', '1:1', or '9:16', defaults to '16:9'"
        ),
      referenceImage: z
        .string()
        .url()
        .optional()
        .describe(
          "The reference image to generate a video from, must be a valid image url, only available for 'wan14b' model"
        ),
      model: z
        .enum(["wan1_3b", "wan14b"])
        .optional()
        .default("wan1_3b")
        .describe(
          "The model to use for video generation, must be either 'wan1_3b' or 'wan14b', 'wan1_3b' is faster but less detailed, 'wan14b' is slower but more detailed"
        ),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create video generation task
      if (!args.prompt) {
        throw new UserError("Prompt is required");
      }
      let taskType =
        args.model === "wan1_3b" ? "txt2video-1.3b" : "txt2video-14b";
      if (args.referenceImage) {
        args.model = "wan14b";
        taskType = "img2video-14b";
      }
      const config = WAN_MODEL_CONFIG[args.model];

      const requestBody = JSON.stringify({
        model: "Qubico/wanx",
        task_type: taskType,
        input: {
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          aspect_ratio: args.aspectRatio,
          image: args.referenceImage,
        },
      });
      const { usage, output } = await handleTask(log, reportProgress, requestBody, config);

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
async function handleTask(log: any, reportProgress: (progress: Progress) => Promise<void>, requestBody: string, config: BaseConfig) {
  const taskId = await createTask(requestBody);
  log.info(`Task created with ID: ${taskId}`);
  return await getTaskResult(log, reportProgress, taskId, config.maxAttempts, config.timeout);
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
  reportProgress: (progress: Progress) => Promise<void>,
  taskId: string,
  maxAttempts: number,
  timeout: number
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    log.info(`Checking task status (attempt ${attempt + 1})...`);

    reportProgress({
      progress: attempt / maxAttempts * 100,
      total: 100,
    });

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
