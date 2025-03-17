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

interface FluxConfig {
  defaultSteps: number;
  maxSteps: number;

  maxAttempts: number;
  interval: number;
}

const FLUX_MODEL_CONFIG: Record<string, FluxConfig> = {
  schnell: { defaultSteps: 4, maxSteps: 10, maxAttempts: 30, interval: 2000 },
  dev: { defaultSteps: 25, maxSteps: 40, maxAttempts: 30, interval: 4000 },
};

function registerFluxTool(server: FastMCP) {
  server.addTool({
    name: "generate_image",
    description: "Generate an image from text using PiAPI Flux",
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
      model: z
        .enum(["schnell", "dev"])
        .optional()
        .default("schnell")
        .describe(
          "The model to use for image generation, must be either 'schnell' or 'dev', 'schnell' is faster and cheaper but less detailed, 'dev' is slower but more detailed"
        ),
    }),
    execute: async (args, { log }) => {
      // Create image generation task
      const config = FLUX_MODEL_CONFIG[args.model];
      let steps = args.steps || config.defaultSteps;
      steps = Math.min(steps, config.maxSteps);

      const requestBody = JSON.stringify({
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

      const taskId = await createTask(requestBody);

      log.info(`Task created with ID: ${taskId}`);

      // Poll for completion
      const { usage, output } = await getTaskStatus(
        taskId,
        config.maxAttempts,
        config.interval
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
    throw new Error(`Task creation failed: ${createData.message}`);
  }

  return createData.data.task_id;
}

async function getTaskStatus(
  taskId: string,
  maxAttempts: number,
  interval: number
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.info(`Checking task status (attempt ${attempt + 1})...`);

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

    console.info(`Task status: ${status}`);

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

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new UserError(
    `Generation timed out after ${(maxAttempts * interval) / 1000} seconds`
  );
}

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
