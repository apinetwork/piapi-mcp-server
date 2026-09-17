import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client, OAuthError, OAuthErrorCode, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthMetadataOptions, AuthInfo } from "@modelcontextprotocol/server";
import { createHttpOAuthTokenVerifier, createHttpTenantResolver } from "./remote-adapters.js";
import { createPiapiAppsRemoteHandler } from "./remote.js";

const catalog = {
  generatedAt: "2026-09-17T00:00:00Z",
  source: "remote-selftest",
  entries: { "model::task": { key: "model::task", model: "model", taskType: "task", params: [] } },
};

let upstreamApiKey: string | undefined;
const upstream = createServer((request, response) => {
  const apiKeyHeader = request.headers["x-api-key"];
  upstreamApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  response.setHeader("content-type", "application/json");
  if (request.method === "POST" && request.url === "/api/v1/task") {
    response.end(JSON.stringify({ code: 200, data: { task_id: "remote-task" } }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/v1/task/remote-task") {
    response.end(JSON.stringify({
      code: 200,
      data: {
        status: "completed",
        output: { image_url: "https://cdn.piapi.ai/remote-smoke.png" },
        meta: { usage: { consume: 1 } },
      },
    }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ code: 404 }));
});
await listen(upstream);
const upstreamAddress = upstream.address();
assert.ok(upstreamAddress && typeof upstreamAddress === "object");

const server = createServer();
await listen(server);
const address = server.address();
assert.ok(address && typeof address === "object");
const resourceServerUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

const delegatedApiBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/api/v1`;
const remoteAdapterVerifier = createHttpOAuthTokenVerifier({
  introspectionUrl: new URL(`http://127.0.0.1:${address.port}/introspect`),
  resourceServerUrl,
  authorizationHeader: "Bearer introspection-service-token",
  fetchImpl: async (url, init) => {
    assert.equal(String(url), `http://127.0.0.1:${address.port}/introspect`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer introspection-service-token");
    assert.equal(init?.body, "token=adapter-token");
    assert.ok(init?.signal);
    return new Response(JSON.stringify({
      active: true,
      sub: "subject-1",
      client_id: "oauth-client-1",
      scope: "mcp media",
      exp: Math.floor(Date.now() / 1000) + 60,
      resource: resourceServerUrl.href,
    }), { status: 200 });
  },
});
const adapterAuth = await remoteAdapterVerifier.verifyAccessToken("adapter-token");
assert.equal(adapterAuth.clientId, "oauth-client-1");
assert.deepEqual(adapterAuth.scopes, ["mcp", "media"]);
assert.equal(adapterAuth.extra?.subject, "subject-1");

const wrongAudienceVerifier = createHttpOAuthTokenVerifier({
  introspectionUrl: new URL(`http://127.0.0.1:${address.port}/introspect`),
  resourceServerUrl,
  authorizationHeader: "Bearer introspection-service-token",
  fetchImpl: async () => new Response(JSON.stringify({
    active: true,
    sub: "subject-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    aud: "https://attacker.example/mcp",
  }), { status: 200 }),
});
await assert.rejects(
  () => wrongAudienceVerifier.verifyAccessToken("wrong-audience-token"),
  (error: unknown) => error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken,
);

const remoteAdapterResolver = createHttpTenantResolver({
  brokerUrl: new URL(`http://127.0.0.1:${address.port}/tenant-broker`),
  authorizationHeader: "Bearer broker-service-token",
  fetchImpl: async (url, init) => {
    assert.equal(String(url), `http://127.0.0.1:${address.port}/tenant-broker`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer broker-service-token");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      subject: "subject-1",
      client_id: "oauth-client-1",
      scopes: ["mcp", "media"],
      expires_at: adapterAuth.expiresAt,
    });
    assert.ok(init?.signal);
    return new Response(JSON.stringify({
      api_key: "dummy-api-key",
      api_base_url: delegatedApiBaseUrl,
    }), { status: 200 });
  },
});
assert.deepEqual(await remoteAdapterResolver.resolve(adapterAuth), {
  apiKey: "dummy-api-key",
  apiBaseUrl: delegatedApiBaseUrl,
});

const authMetadata: AuthMetadataOptions = {
  resourceServerUrl,
  oauthMetadata: {
    issuer: `http://127.0.0.1:${address.port}`,
    authorization_endpoint: `http://127.0.0.1:${address.port}/authorize`,
    token_endpoint: `http://127.0.0.1:${address.port}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
  },
  scopesSupported: ["mcp"],
  resourceName: "PiAPI MCP test",
  dangerouslyAllowInsecureIssuerUrl: true,
};

const handler = createPiapiAppsRemoteHandler({
  resourceServerUrl,
  authMetadata,
  tokenVerifier: {
    async verifyAccessToken(token): Promise<AuthInfo> {
      if (token !== "remote-test-token") throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid test token");
      return {
        token,
        clientId: "remote-test-client",
        scopes: ["mcp"],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        resource: resourceServerUrl,
      };
    },
  },
  tenantResolver: {
    async resolve(auth) {
      assert.equal(auth.clientId, "remote-test-client");
      return { apiKey: "dummy-api-key", apiBaseUrl: delegatedApiBaseUrl };
    },
  },
  catalog,
  mediaDomains: ["https://cdn.piapi.ai"],
  logger: { debug() {}, info() {}, error() {} },
});
server.on("request", toNodeHandler(handler));

try {
  const protectedResource = await fetch(
    new URL("/.well-known/oauth-protected-resource/mcp", resourceServerUrl)
  );
  assert.equal(protectedResource.status, 200);
  const protectedResourceJson = await protectedResource.json() as { resource?: string; authorization_servers?: string[] };
  assert.equal(protectedResourceJson.resource, resourceServerUrl.href);
  assert.deepEqual(protectedResourceJson.authorization_servers, [`http://127.0.0.1:${address.port}`]);

  const denied = await fetch(resourceServerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate") ?? "", /resource_metadata=/);

  const crossOrigin = await fetch(resourceServerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://attacker.example",
    },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);

  const transport = new StreamableHTTPClientTransport(resourceServerUrl, {
    authProvider: { token: async () => "remote-test-token" },
  });
  const client = new Client({ name: "piapi-apps-remote-selftest", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "piapi_run_task"));
  const result = await client.callTool({
    name: "piapi_run_task",
    arguments: { model: "demo", task_type: "image", input: {} },
  });
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { taskId?: string } | undefined)?.taskId, "remote-task");
  assert.equal(upstreamApiKey, "dummy-api-key");
  await client.close();
} finally {
  await handler.close();
  await close(server);
  await close(upstream);
}

console.log("MCP Apps remote OAuth boundary self-test: PASS");

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
