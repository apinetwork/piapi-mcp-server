import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createPiapiAppsServer } from "./server.js";

config();

const apiKey = process.env.PIAPI_API_KEY;
if (!apiKey) {
  process.stderr.write("Error: PIAPI_API_KEY is required for the MCP Apps server\n");
  process.exit(1);
}

try {
  const server = await createPiapiAppsServer({ apiKey });
  await server.connect(new StdioServerTransport());
  process.stderr.write("PiAPI MCP Apps server started\n");
} catch (error) {
  process.stderr.write(`Failed to start PiAPI MCP Apps server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
