# MCP Apps host compatibility

The repository has two independently buildable stdio entrypoints:

- `dist/index.js` is the stable FastMCP compatibility entrypoint. It retains the
  existing tool names and text results for current users.
- `modern/dist/modern/src/index.js` is the MCP Apps preview entrypoint. It adds
  `ui://piapi/media-gallery` while keeping text, structured content, and
  `resource_link` fallbacks in every task result.

This page distinguishes evidence that the server emits interoperable MCP Apps
messages from evidence that a particular desktop application has rendered the
gallery. Do not treat a protocol smoke test as a visual-host certification.

## Matrix — checked September 17, 2026

| Host | MCP Apps support | Local installation | Protocol / stdio evidence | Inline gallery evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Claude Desktop 1.46388.3 | Supported by the MCP Apps client list | Installed | The running app advertises `epitaxyMcpApps: supported`; modern entry passes the repository's stdio smoke test | Not run in the primary user profile | Pending isolated interactive verification |
| VS Code | Supported by the MCP Apps client list | Not installed | Modern entry's protocol smoke exercises tool metadata, `ui://` resource, structured content, and resource links | Not available on this workstation | Blocked by missing host |
| Postman | Supported by the MCP Apps client list | Not installed | Same protocol smoke | Not available on this workstation | Blocked by missing host |
| Goose | Supported by the MCP Apps client list | Not installed | Same protocol smoke | Not available on this workstation | Blocked by missing host |
| MCP Inspector | Development inspector available through `npx` | Available | Can be used to inspect the stdio protocol manually | It is not a certification target for a production host UI | Development-only |

The supported-client list is maintained by the MCP Apps project. Host releases
can change UI behavior independently, so re-check the host documentation before
promoting the preview entrypoint as generally available.

## Repeatable protocol smoke

From the repository root:

```bash
npm run build:all
npm --prefix modern run test
```

The second command includes `modern/scripts/host-smoke.mjs`. It starts a
loopback-only mock PiAPI API, starts the compiled modern stdio executable as a
child process, then uses the official MCP client transport to:

1. list tools and check `ui://piapi/media-gallery` metadata;
2. call `piapi_run_task`;
3. verify text fallback, structured media result, and `resource_link`;
4. read the UI resource and check the MCP Apps HTML media type.

The test uses `PIAPI_API_BASE_URL` only to point at its loopback mock. The
modern executable accepts a HTTPS override in normal use; plain HTTP is
restricted to `localhost` and `127.0.0.1` for this local test path.

## Isolated Claude Desktop visual test

Do **not** edit an active user's `claude_desktop_config.json` to run this
check. Use a disposable profile/configuration and a non-production API
endpoint, then register:

```json
{
  "mcpServers": {
    "piapi-apps-preview": {
      "command": "node",
      "args": ["/absolute/path/to/piapi-mcp-server/modern/dist/modern/src/index.js"],
      "env": {
        "PIAPI_API_KEY": "test-only-key",
        "PIAPI_API_BASE_URL": "http://127.0.0.1:PORT/api/v1"
      }
    }
  }
}
```

Call `piapi_run_task` against a mock endpoint that returns a result containing
at least one image, video, audio, and `.glb` URL. Record whether the host
renders the gallery and whether it still presents the text/links if the app UI
fails. The local script deliberately does not automate this profile or alter a
logged-in Claude Desktop installation.

## Result contract for non-UI hosts

Every modern task result includes:

- a short text summary;
- `structuredContent` with `taskId`, usage, assets, and optional viewer URL;
- one MCP `resource_link` per recognized media asset.

That means a host without MCP Apps UI support can still expose downloadable
URLs, and existing users can stay on the legacy entrypoint without any
configuration change.
