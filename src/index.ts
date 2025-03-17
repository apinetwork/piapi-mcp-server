import { config } from "dotenv";
import { z } from "zod";
import { FastMCP } from "fastmcp";

// Load environment variables
config();

const apiKey = process.env.PIAPI_API_KEY;

if (!apiKey) {
  console.error("Error: PIAPI_API_KEY not set");

  process.exit(1);
}

const server = new FastMCP({
  name: "piapi",
  version: "1.0.0",
});

server.addTool({
  name: "generate_image",
  description: "Generate an image from text using PiAPI Flux",
  parameters: z.object({
    prompt: z.string(),
    width: z.union([z.string(), z.number()]).transform(val =>
      typeof val === 'string' ? parseInt(val) : val
    ).pipe(z.number().min(128).max(1024)).optional().default(1024),
    height: z.union([z.string(), z.number()]).transform(val =>
      typeof val === 'string' ? parseInt(val) : val
    ).pipe(z.number().min(128).max(1024)).optional().default(1024),
  }),
  execute: async (args, { reportProgress }) => {
    await reportProgress({
      progress: 10,
      total: 100
    });

    // Create image generation task
    const createResponse = await fetch("https://api.piapi.ai/api/v1/task", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "Qubico/flux1-schnell",
        task_type: "txt2img",
        input: {
          prompt: args.prompt,
          width: args.width,
          height: args.height,
          negative_prompt: "",
          batch_size: 1,
        },
        config: {
          service_mode: "public",
          webhook_config: {
            endpoint: "",
            secret: "",
          },
        },
      }),
    });

    const createData = await createResponse.json();

    if (createData.code !== 200) {
      throw new Error(`Task creation failed: ${createData.message}`);
    }

    const taskId = createData.data.task_id;

    console.error(`Task created with ID: ${taskId}`);

    // Poll for completion
    const maxAttempts = 60;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.error(`Checking task status (attempt ${attempt + 1})...`);

      // Report progress
      const progress = Math.min(10 + (attempt / maxAttempts * 90), 99);

      await reportProgress({
        progress, total: 100
      });

      const statusResponse = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: {
          "X-API-Key": apiKey,
        },
      });

      const statusData = await statusResponse.json();

      if (statusData.code !== 200) {
        throw new Error(`Status check failed: ${statusData.message}`);
      }

      const { status, output, error } = statusData.data;

      console.error(`Task status: ${status}`);

      if (status === "completed") {
        await reportProgress({
          progress: 100,
          total: 100
        });

        if (!output) {
          throw new Error("Task completed but no output found");
        }

        const urls: string[] = [];
        if (output.image_url) {
          urls.push(output.image_url);
        }
        if (output.image_urls) {
          urls.push(...output.image_urls);
        }

        if (urls.length === 0) {
          throw new Error("Task completed but no image URLs found");
        }

        const usage = statusData.data.meta.usage?.consume || "unknown";

        return {
          content: [
            {
              type: "text",
              text: `Image generated successfully!\nUsage: ${usage} tokens\nURLs:\n${urls.join("\n")}`,
            },
          ],
        };
      }

      if (status === "failed") {
        throw new Error(`Generation failed: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    throw new Error("Generation timed out");
  }
});

// Start the server
async function main() {
  await server.start({
    transportType: 'stdio'
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
