import { config } from "dotenv";
import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthMetadataOptions } from "@modelcontextprotocol/server";
import { createHttpOAuthTokenVerifier, createHttpTenantResolver } from "./remote-adapters.js";
import { createPiapiAppsRemoteHandler } from "./remote.js";

config();

const configValue = loadConfig(process.env);
const authMetadata: AuthMetadataOptions = {
  resourceServerUrl: configValue.resourceServerUrl,
  oauthMetadata: {
    issuer: configValue.oauthIssuer.href.replace(/\/$/, ""),
    authorization_endpoint: configValue.authorizationEndpoint.href,
    token_endpoint: configValue.tokenEndpoint.href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
  },
  scopesSupported: ["mcp"],
  resourceName: "PiAPI MCP",
};

const handler = createPiapiAppsRemoteHandler({
  resourceServerUrl: configValue.resourceServerUrl,
  authMetadata,
  tokenVerifier: createHttpOAuthTokenVerifier({
    introspectionUrl: configValue.introspectionUrl,
    resourceServerUrl: configValue.resourceServerUrl,
    authorizationHeader: configValue.introspectionAuthorization,
  }),
  tenantResolver: createHttpTenantResolver({
    brokerUrl: configValue.tenantBrokerUrl,
    authorizationHeader: configValue.tenantBrokerAuthorization,
  }),
  allowedHostnames: [configValue.resourceServerUrl.hostname],
  allowedOriginHostnames: configValue.allowedOriginHostnames,
});

const server = createServer(toNodeHandler(handler));
server.listen(configValue.port, configValue.bindHost, () => {
  process.stderr.write(`PiAPI remote MCP server listening on ${configValue.bindHost}:${configValue.port}${configValue.resourceServerUrl.pathname}\n`);
});

async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`Received ${signal}; stopping PiAPI remote MCP server\n`);
  await handler.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

interface RemoteDeploymentConfig {
  resourceServerUrl: URL;
  oauthIssuer: URL;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  introspectionUrl: URL;
  introspectionAuthorization: string;
  tenantBrokerUrl: URL;
  tenantBrokerAuthorization: string;
  bindHost: string;
  port: number;
  allowedOriginHostnames?: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv): RemoteDeploymentConfig {
  const resourceServerUrl = requiredUrl(env.PIAPI_MCP_PUBLIC_URL, "PIAPI_MCP_PUBLIC_URL");
  const oauthIssuer = requiredUrl(env.PIAPI_MCP_OAUTH_ISSUER, "PIAPI_MCP_OAUTH_ISSUER");
  const authorizationEndpoint = requiredUrl(env.PIAPI_MCP_OAUTH_AUTHORIZATION_ENDPOINT, "PIAPI_MCP_OAUTH_AUTHORIZATION_ENDPOINT");
  const tokenEndpoint = requiredUrl(env.PIAPI_MCP_OAUTH_TOKEN_ENDPOINT, "PIAPI_MCP_OAUTH_TOKEN_ENDPOINT");
  const introspectionUrl = requiredUrl(env.PIAPI_MCP_OAUTH_INTROSPECTION_URL, "PIAPI_MCP_OAUTH_INTROSPECTION_URL");
  const tenantBrokerUrl = requiredUrl(env.PIAPI_MCP_TENANT_BROKER_URL, "PIAPI_MCP_TENANT_BROKER_URL");
  const introspectionAuthorization = requiredBearer(env.PIAPI_MCP_OAUTH_INTROSPECTION_AUTHORIZATION, "PIAPI_MCP_OAUTH_INTROSPECTION_AUTHORIZATION");
  const tenantBrokerAuthorization = requiredBearer(env.PIAPI_MCP_TENANT_BROKER_AUTHORIZATION, "PIAPI_MCP_TENANT_BROKER_AUTHORIZATION");
  const bindHost = env.PIAPI_MCP_BIND_HOST?.trim() || "127.0.0.1";
  const port = Number(env.PIAPI_MCP_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PIAPI_MCP_PORT must be a valid TCP port");

  const allowedOriginHostnames = env.PIAPI_MCP_ALLOWED_ORIGIN_HOSTNAMES
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    resourceServerUrl,
    oauthIssuer,
    authorizationEndpoint,
    tokenEndpoint,
    introspectionUrl,
    introspectionAuthorization,
    tenantBrokerUrl,
    tenantBrokerAuthorization,
    bindHost,
    port,
    ...(allowedOriginHostnames?.length ? { allowedOriginHostnames } : {}),
  };
}

function requiredUrl(value: string | undefined, name: string): URL {
  if (!value) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} cannot contain credentials, a query string, or a fragment`);
  return url;
}

function requiredBearer(value: string | undefined, name: string): string {
  if (!value || !/^Bearer\s+\S+$/i.test(value)) throw new Error(`${name} must be a non-empty Bearer token`);
  return value;
}
