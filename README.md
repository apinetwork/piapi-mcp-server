# piapi-mcp-server
[![Website](https://img.shields.io/badge/Website-piapi.ai-blue?style=flat-square&logo=internet-explorer)](https://piapi.ai)
[![Documentation](https://img.shields.io/badge/Documentation-docs-green?style=flat-square&logo=bookstack)](https://piapi.ai/docs)
[![Discord](https://img.shields.io/badge/Discord-Join%20chat-7289da?style=flat-square&logo=discord)](https://discord.gg/qRRvcGa7Wb)

A TypeScript implementation of a Model Context Protocol (MCP) server that integrates with PiAPI's API. PiAPI makes user able to generate media content with Midjourney/Flux/Kling/LumaLabs/Udio/Chrip/Trellis directly from Claude or any other MCP-compatible apps.

<a href="https://glama.ai/mcp/servers/ywvke8xruo"><img width="380" height="200" src="https://glama.ai/mcp/servers/ywvke8xruo/badge" alt="PiAPI-Server MCP server" /></a>

## Features (more coming soon)

Note: Time-consuming tools like video generation may not complete due to Claude's timeout limitations

- [ ] Base Image toolkit
- [ ] Base Video toolkit
- [x] Flux Image generation from text descriptions
- [x] Flux Image generation with image prompt
- [x] Hunyuan Video generation from text descriptions
- [x] Hunyuan Video generation from image prompt
- [ ] Skyreels Video generation from image prompt
- [x] Wan Video generation from text descriptions
- [x] Wan Video generation from image prompt
- [ ] Midjourney Image generation
- [ ] Kling video generation
- [ ] Luma Dream Machine video generation
- [ ] Suno/Udio ai song generation
- [ ] Trellis 3D model generation
- [ ] Workflow planning inside LLMs

## Working with Claude Desktop
![image](https://github.com/user-attachments/assets/a7567797-47e1-43dd-9505-f2677f9fa4f6)


## Prerequisites

- Node.js 16.x or higher
- npm or yarn
- A PiAPI API key (get one at [piapi.ai](https://piapi.ai/workspace/key))

## Installation

1. Clone the repository:
```bash
git clone https://github.com/apinetwork/piapi-mcp-server
cd piapi-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root:
```bash
PIAPI_API_KEY=your_api_key_here
```

4. Build the project:
```bash
npm run build
```

5. Test server with MCP Inspector:
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


## Development

### Project Structure
```
piapi-mcp-server/
├── src/
│   ├── index.ts        # Main server entry point
├── package.json
├── tsconfig.json
└── .env
```


## License

MIT
