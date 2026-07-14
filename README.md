# piapi-mcp-server

[![Website](https://img.shields.io/badge/Website-piapi.ai-blue?style=flat-square&logo=internet-explorer)](https://piapi.ai)
[![Documentation](https://img.shields.io/badge/Documentation-docs-green?style=flat-square&logo=bookstack)](https://piapi.ai/docs)
[![Discord](https://img.shields.io/badge/Discord-Join%20chat-7289da?style=flat-square&logo=discord)](https://discord.gg/qRRvcGa7Wb)

[![smithery badge](https://smithery.ai/badge/piapi-mcp-server)](https://smithery.ai/server/piapi-mcp-server)

A TypeScript implementation of a Model Context Protocol (MCP) server that integrates with PiAPI's API. PiAPI makes user able to generate media content with Midjourney/Flux/Kling/LumaLabs/Udio/Chrip/Trellis directly from Claude or any other MCP-compatible apps.

<a href="https://glama.ai/mcp/servers/ywvke8xruo"><img width="380" height="200" src="https://glama.ai/mcp/servers/ywvke8xruo/badge" alt="PiAPI-Server MCP server" /></a>

## Features (more coming soon)

Note: Time-consuming tools like video generation may not complete due to Claude's timeout limitations

- [x] Base Image toolkit
- [x] Base Video toolkit
- [x] Flux Image generation from text/image prompt
- [x] Hunyuan Video generation from text/image prompt
- [x] Skyreels Video generation from image prompt
- [x] Wan Video generation from text/image prompt
- [x] MMAudio Music generation from video
- [x] TTS Zero-Shot voice generation
- [ ] Midjourney Image generation
  - [x] imagine
  - [ ] other
- [x] Kling Video and Effects generation
- [x] Luma Dream Machine video generation
- [x] Suno Music generation
- [ ] Suno Lyrics generation
- [ ] Udio Music and Lyrics generation
- [x] Trellis 3D model generation from image
- [ ] Workflow planning inside LLMs

## Working with Claude Desktop Example

![image](./assets/Claude-desktop.png)

## Prerequisites

- Node.js 16.x or higher
- npm or yarn
- A PiAPI API key (get one at [piapi.ai](https://piapi.ai/workspace/key))

## Installation

### Installing via Smithery

To install PiAPI MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/piapi-mcp-server):

```bash
npx -y @smithery/cli install piapi-mcp-server --client claude
```

### Manual Installation
1. Clone the repository:

```bash
git clone https://github.com/apinetwork/piapi-mcp-server
cd piapi-mcp-server
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

After building, a `dist/index.js` file will be generated. You can then configure this file with Claude Desktop and other applications. For detailed configuration instructions, please refer to the Usage section.

4. (Optional) Test server with MCP Inspector:

First, create a `.env` file in the project root directory with your API key:

```bash
PIAPI_API_KEY=your_api_key_here
```

Then run the following command to start the MCP Inspector:

```bash
npm run inspect
```

After running the command, MCP Inspector will be available at http://localhost:5173 (default port: 5173). Open this URL in your browser to start testing. The default timeout for inspector operations is 10000ms (10 seconds), which may not be sufficient for image generation tasks. It's recommended to increase the timeout when testing image generation or other time-consuming operations. You can adjust the timeout by adding a timeout parameter to the URL, for example: http://localhost:5173?timeout=60000 (sets timeout to 60 seconds)

The MCP Inspector is a powerful development tool that helps you test and debug your MCP server implementation. Key features include:

- **Interactive Testing**: Test your server's functions directly through a web interface
- **Real-time Feedback**: See immediate results of your function calls and any errors that occur
- **Request/Response Inspection**: View detailed information about requests and responses
- **Function Documentation**: Browse available functions and their parameters
- **Custom Parameters**: Set custom timeout values and other configuration options
- **History Tracking**: Keep track of your previous function calls and their results

For detailed information about using the MCP Inspector and its features, visit the [official MCP documentation](https://modelcontextprotocol.io/docs/tools/inspector).

## Usage

### Connecting to Claude Desktop

Add this to your Claude Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "piapi": {
      "command": "node",
      "args": ["/absolute/path/to/piapi-mcp-server/dist/index.js"],
      "env": {
        "PIAPI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

After updating your configuration file, you need to restart Claude for Desktop. Upon restarting, you should see a hammer icon in the bottom right corner of the input box.
For more detailed information, visit the [official MCP documentation](https://modelcontextprotocol.io/quickstart/user)

### Connecting to Cursor

Note: Following guide is based on Cursor 0.47.5. Features and behaviors may vary in different versions.

To configure the MCP server:

1. Navigate to: File > Preferences > Cursor Settings, or use the shortcut key `Ctrl+Shift+J`
2. Select "MCP" tab on the left panel
3. Click "Add new global MCP server" button in the top right
4. Add your configuration in the opened mcp.json file

```json
{
  "mcpServers": {
    "piapi": {
      "command": "node",
      "args": ["/absolute/path/to/piapi-mcp-server/dist/index.js"],
      "env": {
        "PIAPI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

5. After configuration, you'll see a "piapi" entry in MCP Servers page
6. Click the Refresh button on the entry or restart Cursor to connect to the piapi server

To test the piapi image generation:

1. Open and select "Agent mode" in Cursor Chat, or use the shortcut key `Ctrl+I`
2. Enter a test prompt, for example: "generate image of a dog"
3. The image will be generated based on your prompt using piapi server

To disable the piapi server:

1. Navigate to the MCP Servers page in Cursor Settings
2. Find the "piapi" entry in the server list
3. Click the "Enabled" toggle button to switch it to "Disabled"

## Keeping tools in sync with PiAPI (sync task)

The MCP tool definitions in `src/index.ts` hard-code PiAPI's models, `task_type`s
and input parameters. When PiAPI changes its API (adds/deprecates a model,
changes parameters, or changes a description/price) the tools can drift out of
date. This repo ships a **periodic sync task** that detects that drift.

**Source of truth:** the PiAPI Apidog project (id `675356`), exported as OpenAPI
via the Apidog Open API. The task normalizes that spec into a catalog keyed by
`(model, task_type)`, diffs it against a committed baseline
(`src/sync/baseline.piapi-catalog.json`), and reports changes in four
categories: **new APIs**, **deprecated APIs**, **parameter changes**, and
**description/price changes**.

### Setup

Provide an Apidog access token with maintainer privilege on the PiAPI project
(in `.env` locally, or as the `APIDOG_ACCESS_TOKEN` repo secret for CI):

```bash
APIDOG_ACCESS_TOKEN=your-apidog-token
APIDOG_PROJECT_ID=675356
```

No token? You can run against a local OpenAPI export instead (e.g. exported from
the Apidog UI):

```bash
node dist/sync/cli.js diff --file ./piapi-openapi.json
```

### Commands

```bash
npm run build          # compile (also compiles the sync task under dist/sync)
npm run test:sync      # offline self-test of the diff engine (no token needed)
npm run sync           # diff upstream vs baseline; exit 0 = in sync, 2 = drift
npm run sync:snapshot  # print the normalized upstream catalog (JSON)
npm run sync:report    # write the Markdown drift report to sync-report.md
npm run sync:accept    # after updating src/index.ts, refresh the baseline
```

Typical loop when drift is reported: read the report → update the matching
`server.addTool(...)` definition(s) in `src/index.ts` (model name, `task_type`,
Zod parameter schema) → `npm run sync:accept` to record the new baseline →
commit.

> Note on prices: the Apidog OpenAPI export reliably covers new/deprecated APIs
> and parameter changes. Per-model **price** is only detected when the upstream
> doc text carries a price hint; if PiAPI keeps pricing on a separate page, wire
> an additional price source into `src/sync/fetchers.ts`.

### Automation

`.github/workflows/sync-piapi.yml` runs the task weekly (and on demand). On drift
it opens/updates a GitHub issue labelled `piapi-sync` with the report, so a
maintainer can bring `src/index.ts` back in line.

## Development

### Project Structure

```
piapi-mcp-server/
├── assets/
├── src/
│   ├── index.ts        # Main server entry point
│   └── sync/           # PiAPI -> MCP sync task
│       ├── cli.ts          # CLI: snapshot / diff / accept / report-file
│       ├── fetchers.ts     # Apidog Open API + local-file OpenAPI sources
│       ├── normalize.ts    # OpenAPI -> (model, task_type) catalog
│       ├── diff.ts         # catalog diff + Markdown report
│       ├── catalog.ts      # baseline load/save
│       ├── selftest.ts     # offline engine test (npm run test:sync)
│       ├── types.ts
│       └── baseline.piapi-catalog.json  # committed baseline
├── .github/workflows/sync-piapi.yml     # weekly drift check
├── package.json
├── tsconfig.json
└── .env.example
```

## License

MIT
