import { config } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Load environment variables
config();

const apiKey = process.env.PIAPI_API_KEY;
if (!apiKey) {
  console.error("Error: PIAPI_API_KEY not set");
  process.exit(1);
}

// Create server instance
const server = new Server({
  name: "piapi",
  version: "1.0.0",
  capabilities: {
    tools: {}
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("Handling list_tools request");
  return {
    tools: [
      {
        name: "generate_image",
        description: "Generate an image from text using PiAPI Flux",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Text description of the image to generate",
            },
            width: {
              type: "integer",
              description: "Image width (default: 1024, max: 1024)",
              default: 1024,
              maximum: 1024,
            },
            height: {
              type: "integer",
              description: "Image height (default: 1024, max: 1024)",
              default: 1024,
              maximum: 1024,
            }
          },
          required: ["prompt"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name !== "generate_image") {
      return {
        content: [
          {
            type: "text",
            text: `Error: Unknown tool ${request.params.name}`,
          },
        ],
      };
    }

    const args = z.object({
      prompt: z.string(),
      width: z.union([z.string(), z.number()]).transform(val => 
        typeof val === 'string' ? parseInt(val) : val
      ).pipe(z.number().min(1).max(1024)).optional().default(1024),
      height: z.union([z.string(), z.number()]).transform(val => 
        typeof val === 'string' ? parseInt(val) : val
      ).pipe(z.number().min(1).max(1024)).optional().default(1024),
    }).parse(request.params.arguments);

    // Report initial progress
    const progressToken = request.params._meta?.progressToken;
    const reportProgress = async (current: number, total: number) => {
      if (progressToken) {
        await server.notification({
          method: "notifications/progress",
          params: {
            token: progressToken,
            current,
            total
          }
        });
      }
    };

    await reportProgress(10, 100);

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
      await reportProgress(progress, 100);

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
        await reportProgress(100, 100);

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
  } catch (error) {
    console.error("Error in tool execution:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error in tool execution: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PiAPI MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
