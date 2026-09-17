import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { apiBaseUrlFromEnvironment } from "./api-base-url.js";
import { createPiapiAppsServer } from "./server.js";

config();

const apiKey = process.env.PIAPI_API_KEY;
if (!apiKey) {
  process.stderr.write("Error: PIAPI_API_KEY is required for the MCP Apps server\n");
  process.exit(1);
}

try {
  const server = await createPiapiAppsServer({
    apiKey,
    apiBaseUrl: apiBaseUrlFromEnvironment(process.env.PIAPI_API_BASE_URL),
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write("PiAPI MCP Apps server started\n");
} catch (error) {
  process.stderr.write(`Failed to start PiAPI MCP Apps server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
