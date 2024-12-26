# piapi-mcp-server
[![Website](https://img.shields.io/badge/Website-piapi.ai-blue?style=flat-square&logo=internet-explorer)](https://piapi.ai)
[![Documentation](https://img.shields.io/badge/Documentation-docs-green?style=flat-square&logo=bookstack)](https://piapi.ai/docs)
[![Discord](https://img.shields.io/badge/Discord-Join%20chat-7289da?style=flat-square&logo=discord)](https://discord.gg/qRRvcGa7Wb)

A TypeScript implementation of a Model Context Protocol (MCP) server that integrates with PiAPI's API. PiAPI makes user able to generate media content with Midjourney/Flux/Kling/LumaLabs/Udio/Chrip/Trellis directly from Claude or any other MCP-compatible apps.

## Features (more coming soon)

- [x] Flux Image generation from text descriptions
- [ ] Flux Image generation with image prompt
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

## Usage

### Running the Server

```bash
npm start
```

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
