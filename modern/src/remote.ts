import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  requireBearerAuth,
  type AuthInfo,
  type AuthMetadataOptions,
  type McpHttpHandler,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import type { PiapiCatalog } from "../../src/sync/types.js";
import type { TaskConfig } from "../../src/core/piapi-task.js";
import { createPiapiAppsServer, type AppsLogger } from "./server.js";

export interface PiapiMcpTenant {
  /** Stored only in the trusted server-side credential resolver. */
  apiKey: string;
  apiBaseUrl?: string;
}

export interface PiapiMcpTenantResolver {
  resolve(auth: AuthInfo): Promise<PiapiMcpTenant>;
}

export interface PiapiAppsRemoteOptions {
  /**
   * Public MCP endpoint, including its exact path (for example
   * `https://mcp.example.com/mcp`). HTTPS is required in production by the
   * OAuth metadata helper; loopback HTTP is only suitable for a local test.
   */
  resourceServerUrl: URL;
  /**
   * Resource-server metadata used for OAuth discovery. The authorization
   * server itself is deliberately external: PiAPI's account/OAuth service
   * owns issuance, consent, refresh, revocation, and tenant identity.
   */
  authMetadata: AuthMetadataOptions;
  tokenVerifier: OAuthTokenVerifier;
  tenantResolver: PiapiMcpTenantResolver;
  requiredScopes?: string[];
  allowedHostnames?: string[];
  allowedOriginHostnames?: string[];
  catalog?: PiapiCatalog;
  taskConfig?: TaskConfig;
  mediaDomains?: string[];
  viewerBaseUrl?: string;
  logger?: AppsLogger;
}

/**
 * Builds a stateless, authenticated Streamable HTTP MCP handler.
 *
 * Each request creates a fresh MCP server using credentials resolved from its
 * validated OAuth subject. This prevents a PiAPI key for one tenant being
 * retained in a connection or reused for a different bearer token.
 */
export function createPiapiAppsRemoteHandler(options: PiapiAppsRemoteOptions): McpHttpHandler {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(options.resourceServerUrl);
  const requiredScopes = options.requiredScopes ?? ["mcp"];
  const authorize = requireBearerAuth({
    verifier: options.tokenVerifier,
    requiredScopes,
    resourceMetadataUrl,
  });

  const mcp = createMcpHandler(async (context) => {
    if (!context.authInfo) throw new Error("Authenticated MCP request did not include auth information");
    const tenant = await options.tenantResolver.resolve(context.authInfo);
    if (!tenant.apiKey) throw new Error("Authenticated tenant has no PiAPI credential");
    return createPiapiAppsServer({
      apiKey: tenant.apiKey,
      ...(tenant.apiBaseUrl ? { apiBaseUrl: tenant.apiBaseUrl } : {}),
      ...(options.catalog ? { catalog: options.catalog } : {}),
      ...(options.taskConfig ? { taskConfig: options.taskConfig } : {}),
      ...(options.mediaDomains ? { mediaDomains: options.mediaDomains } : {}),
      ...(options.viewerBaseUrl ? { viewerBaseUrl: options.viewerBaseUrl } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }, {
    // Retain a compatibility path for pre-2026 MCP HTTP clients without
    // reintroducing stateful sessions that can cross tenant boundaries.
    legacy: "stateless",
    responseMode: "auto",
    onerror: (error) => options.logger?.error(`Remote MCP handler error: ${error.message}`),
  });

  return {
    ...mcp,
    fetch: async (request, requestOptions) => {
      const rejectedHost = hostHeaderValidationResponse(
        request,
        options.allowedHostnames ?? [options.resourceServerUrl.hostname]
      );
      if (rejectedHost) return rejectedHost;

      if (options.allowedOriginHostnames) {
        const rejectedOrigin = originValidationResponse(request, options.allowedOriginHostnames);
        if (rejectedOrigin) return rejectedOrigin;
      }

      const metadata = oauthMetadataResponse(request, options.authMetadata);
      if (metadata) return metadata;

      const requestUrl = new URL(request.url);
      if (requestUrl.pathname !== options.resourceServerUrl.pathname) {
        return new Response("Not found", { status: 404 });
      }

      const auth = await authorize(request);
      if (auth instanceof Response) return auth;
      return mcp.fetch(request, { ...requestOptions, authInfo: auth });
    },
  };
}
