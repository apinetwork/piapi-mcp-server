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

registerTools(server);

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

// Register Tools
function registerTools(server: FastMCP) {
  registerGeneralTool(server);
  registerImageTool(server);
  registerVideoTool(server);
  registerFluxTool(server);
  registerHunyuanTool(server);
  registerSkyreelsTool(server);
  registerWanTool(server);
  registerMMAudioTool(server);
  registerTTSTool(server);
  registerTrellisTool(server);
}

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

const IMAGE_TOOL_CONFIG: Record<string, BaseConfig> = {
  faceswap: { maxAttempts: 30, timeout: 60 },
  rmbg: { maxAttempts: 30, timeout: 60 },
  segment: { maxAttempts: 30, timeout: 60 },
  upscale: { maxAttempts: 30, timeout: 60 },
};

function registerImageTool(server: FastMCP) {
  server.addTool({
    name: "image_faceswap",
    description: "Faceswap an image",
    parameters: z.object({
      swapImage: z.string().url().describe("The URL of the image to swap"),
      targetImage: z.string().url().describe("The URL of the target image"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.swapImage || !args.targetImage) {
        throw new UserError("Swap image and target image are required");
      }
      const config = IMAGE_TOOL_CONFIG["faceswap"];

      let requestBody = JSON.stringify({
        model: "Qubico/image-toolkit",
        task_type: "face-swap",
        input: {
          swap_image: args.swapImage,
          target_image: args.targetImage,
        },
      });

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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
    name: "image_rmbg",
    description: "Remove the background of an image",
    parameters: z.object({
      image: z
        .string()
        .url()
        .describe("The URL of the image to remove the background"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.image) {
        throw new UserError("Image URL is required");
      }
      const config = IMAGE_TOOL_CONFIG["rmbg"];

      let requestBody = JSON.stringify({
        model: "Qubico/image-toolkit",
        task_type: "background-remove",
        input: {
          image: args.image,
        },
      });

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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
    name: "image_segment",
    description: "Segment an image",
    parameters: z.object({
      image: z.string().url().describe("The URL of the image to segment"),
      prompt: z.string().describe("The prompt to segment the image"),
      negativePrompt: z
        .string()
        .optional()
        .describe("The negative prompt to segment the image"),
      segmentFactor: z
        .number()
        .optional()
        .default(-15)
        .describe("The factor to segment the image"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.image || !args.prompt) {
        throw new UserError("Image URL and prompt are required");
      }
      const config = IMAGE_TOOL_CONFIG["segment"];

      let requestBody = JSON.stringify({
        model: "Qubico/image-toolkit",
        task_type: "segment",
        input: {
          image: args.image,
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          segment_factor: args.segmentFactor,
        },
      });

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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
    name: "image_upscale",
    description: "Upscale an image to a higher resolution",
    parameters: z.object({
      image: z.string().url().describe("The URL of the image to upscale"),
      scale: z
        .number()
        .pipe(z.number().min(2).max(10))
        .optional()
        .default(2)
        .describe("The scale of the image to upscale, defaults to 2"),
      faceEnhance: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to enhance the face of the image"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.image) {
        throw new UserError("Image URL is required");
      }
      const config = IMAGE_TOOL_CONFIG["upscale"];

      let requestBody = JSON.stringify({
        model: "Qubico/image-toolkit",
        task_type: "upscale",
        input: {
          image: args.image,
          scale: args.scale,
          face_enhance: args.faceEnhance,
        },
      });

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

const VIDEO_TOOL_CONFIG: Record<string, BaseConfig> = {
  faceswap: { maxAttempts: 30, timeout: 600 },
  upscale: { maxAttempts: 30, timeout: 300 },
};

function registerVideoTool(server: FastMCP) {
  server.addTool({
    name: "video_faceswap",
    description: "Faceswap a video",
    parameters: z.object({
      swapImage: z.string().url().describe("The URL of the image to swap"),
      targetVideo: z
        .string()
        .url()
        .describe("The URL of the video to faceswap"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.swapImage || !args.targetVideo) {
        throw new UserError("Swap image and target video are required");
      }
      const config = VIDEO_TOOL_CONFIG["faceswap"];

      let requestBody = JSON.stringify({
        model: "Qubico/video-toolkit",
        task_type: "face-swap",
        input: {
          swap_image: args.swapImage,
          target_video: args.targetVideo,
        },
      });

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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
  server.addTool({
    name: "video_upscale",
    description: "Upscale video resolution to 2x",
    parameters: z.object({
      video: z.string().url().describe("The URL of the video to upscale"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create image generation task
      if (!args.video) {
        throw new UserError("Video URL is required");
      }
      const config = VIDEO_TOOL_CONFIG["upscale"];

      let requestBody = JSON.stringify({
        model: "Qubico/video-toolkit",
        task_type: "upscale",
        input: {
          video: args.video,
        },
      });

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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
  hunyuanConcat: {
    maxAttempts: 60,
    timeout: 900,
    taskType: "img2video-concat",
  },
  hunyuanReplace: {
    maxAttempts: 60,
    timeout: 900,
    taskType: "img2video-replace",
  },
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
      if (
        args.referenceImage &&
        (args.model === "hunyuan" || args.model === "fastHunyuan")
      ) {
        log.warn(
          "Reference image is not supported for 'hunyuan' or 'fastHunyuan' model, using 'hunyuanConcat' as default"
        );
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
      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

const SKYREELS_MODEL_CONFIG: Record<string, BaseConfig> = {
  skyreels: { maxAttempts: 30, timeout: 300 },
};

function registerSkyreelsTool(server: FastMCP) {
  server.addTool({
    name: "generate_video_skyreels",
    description: "Generate a video using PiAPI Skyreels",
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
        .describe(
          "The reference image to generate a video from, must be a valid image url, only available for 'wan14b' model"
        ),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create video generation task
      if (!args.prompt || !args.referenceImage) {
        throw new UserError("Prompt and reference image are required");
      }
      const config = SKYREELS_MODEL_CONFIG["skyreels"];

      const requestBody = JSON.stringify({
        model: "Qubico/skyreels",
        task_type: "img2video",
        input: {
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          aspect_ratio: args.aspectRatio,
          image: args.referenceImage,
        },
      });
      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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
      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

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

const MMAUDIO_MODEL_CONFIG: Record<string, BaseConfig> = {
  mmaudio: { maxAttempts: 30, timeout: 600 },
};

function registerMMAudioTool(server: FastMCP) {
  server.addTool({
    name: "generate_music_for_video",
    description: "Generate a music for a video using PiAPI MMAudio",
    parameters: z.object({
      prompt: z.string().describe("The prompt to generate a music from"),
      negativePrompt: z
        .string()
        .describe("The negative prompt to generate a music from")
        .optional()
        .default("chaos, bad music"),
      video: z.string().url().describe("The video to generate a music from"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create video generation task
      if (!args.prompt || !args.video) {
        throw new UserError("Prompt and video are required");
      }
      const config = MMAUDIO_MODEL_CONFIG["mmaudio"];

      const requestBody = JSON.stringify({
        model: "Qubico/mmaudio",
        task_type: "video2audio",
        input: {
          prompt: args.prompt,
          negative_prompt: args.negativePrompt,
          video: args.video,
        },
      });
      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

      const url = parseAudioOutput(output);
      return {
        content: [
          {
            type: "text",
            text: `Music generated successfully!\nUsage: ${usage} tokens\nMusic url:\n${url}`,
          },
        ],
      };
    },
  });
}

const TTS_MODEL_CONFIG: Record<string, BaseConfig> = {
  zeroShot: { maxAttempts: 30, timeout: 600 },
};

function registerTTSTool(server: FastMCP) {
  server.addTool({
    name: "generate_zero_shot_tts",
    description: "Zero-shot TTS using PiAPI f5-tts",
    parameters: z.object({
      genText: z.string().describe("The text to generate a speech from"),
      refText: z
        .string()
        .optional()
        .describe(
          "The reference text to generate a speech from, auto detect from refAudio if not provided"
        ),
      refAudio: z
        .string()
        .url()
        .describe("The reference audio to generate a speech from"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create video generation task
      if (!args.genText || !args.refAudio) {
        throw new UserError("genText and refAudio are required");
      }
      const config = TTS_MODEL_CONFIG["zeroShot"];

      const requestBody = JSON.stringify({
        model: "Qubico/tts",
        task_type: "zero-shot",
        input: {
          gen_text: args.genText,
          ref_text: args.refText,
          ref_audio: args.refAudio,
        },
      });
      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

      const url = parseAudioOutput(output);
      return {
        content: [
          {
            type: "text",
            text: `Speech generated successfully!\nUsage: ${usage} tokens\nSpeech url:\n${url}`,
          },
        ],
      };
    },
  });
}

const TRELLIS_MODEL_CONFIG: Record<string, BaseConfig> = {
  trellis: { maxAttempts: 30, timeout: 600 },
};

function registerTrellisTool(server: FastMCP) {
  server.addTool({
    name: "generate_3d_model",
    description: "Generate a 3d model using PiAPI Trellis",
    parameters: z.object({
      image: z.string().url().describe("The image to generate a 3d model from"),
    }),
    execute: async (args, { log, reportProgress }) => {
      // Create 3d model generation task
      if (!args.image) {
        throw new UserError("Image is required");
      }
      const config = TRELLIS_MODEL_CONFIG["trellis"];

      const requestBody = JSON.stringify({
        model: "Qubico/trellis",
        task_type: "image-to-3d",
        input: {
          image: args.image,
        },
      });
      const { usage, output } = await handleTask(
        log,
        reportProgress,
        requestBody,
        config
      );

      const [imageUrl, videoUrl, modelFileUrl] = parseTrellisOutput(output);
      return {
        content: [
          {
            type: "text",
            text: `3d model generated successfully!\nUsage: ${usage} tokens\nImage url:\n${imageUrl}\nVideo url:\n${videoUrl}\nModel file url:\n${modelFileUrl}`,
          },
        ],
      };
    },
  });
}

// Task handler
async function handleTask(
  log: any,
  reportProgress: (progress: Progress) => Promise<void>,
  requestBody: string,
  config: BaseConfig
) {
  const taskId = await createTask(requestBody);
  log.info(`Task created with ID: ${taskId}`);
  return await getTaskResult(
    log,
    reportProgress,
    taskId,
    config.maxAttempts,
    config.timeout
  );
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
      progress: (attempt / maxAttempts) * 100,
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
  const imageUrls = [
    ...(imageOutput.image_url ? [imageOutput.image_url] : []),
    ...(imageOutput.image_urls || []),
  ].filter(Boolean);

  if (imageUrls.length === 0) {
    throw new UserError("Task completed but no image URLs found");
  }

  return imageUrls;
}

const AudioOutputSchema = z
  .object({
    audio_url: z.string(),
  })
  .refine((data) => data.audio_url, {
    message: "At least one audio URL must be provided",
    path: ["audio_url"],
  });

function parseAudioOutput(output: unknown): string {
  const result = AudioOutputSchema.safeParse(output);

  if (!result.success) {
    throw new UserError(`Invalid audio output format: ${result.error.message}`);
  }

  const audioUrl = result.data.audio_url;

  if (!audioUrl) {
    throw new UserError("Task completed but no audio URL found");
  }

  return audioUrl;
}

const VideoOutputSchema = z
  .object({
    video_url: z.string(),
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

  const videoUrl = result.data.video_url;

  if (!videoUrl) {
    throw new UserError("Task completed but no video URL found");
  }

  return videoUrl;
}

const TrellisOutputSchema = z
  .object({
    no_background_image: z.string(),
    combined_video: z.string(),
    model_file: z.string(),
  })
  .refine(
    (data) =>
      data.no_background_image && data.combined_video && data.model_file,
    {
      message: "At least one image/video/model file URL must be provided",
      path: ["no_background_image", "combined_video", "model_file"],
    }
  );

function parseTrellisOutput(output: unknown): [string, string, string] {
  const result = TrellisOutputSchema.safeParse(output);

  if (!result.success) {
    throw new UserError(`Invalid video output format: ${result.error.message}`);
  }

  const imageUrl = result.data.no_background_image;
  const videoUrl = result.data.combined_video;
  const modelFileUrl = result.data.model_file;

  if (!imageUrl || !videoUrl || !modelFileUrl) {
    throw new UserError(
      "Task completed but no image/video/model file URL found"
    );
  }

  return [imageUrl, videoUrl, modelFileUrl];
}
