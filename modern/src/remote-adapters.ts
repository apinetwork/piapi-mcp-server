import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { PiapiMcpTenant, PiapiMcpTenantResolver } from "./remote.js";

type FetchLike = typeof fetch;

interface OAuthIntrospectionResponse {
  active?: boolean;
  sub?: string;
  client_id?: string;
  scope?: string | string[];
  exp?: number;
  resource?: string;
  aud?: string | string[];
}

interface TenantResolutionResponse {
  api_key?: string;
  api_base_url?: string;
}

export interface HttpOAuthTokenVerifierOptions {
  introspectionUrl: URL;
  resourceServerUrl: URL;
  /**
   * An OAuth-client credential for the introspection endpoint. This is a
   * deployment secret, never an MCP client token or PiAPI user credential.
   */
  authorizationHeader: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface HttpTenantResolverOptions {
  brokerUrl: URL;
  /**
   * Service-to-service authorization for the trusted credential broker.
   * The broker must reject arbitrary external callers and must not return
   * a tenant API key to a browser or untrusted client.
   */
  authorizationHeader: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export function createHttpOAuthTokenVerifier(options: HttpOAuthTokenVerifierOptions): OAuthTokenVerifier {
  assertSecureServiceUrl(options.introspectionUrl, "OAuth introspection URL");
  assertSecureServiceUrl(options.resourceServerUrl, "MCP resource server URL");
  assertAuthorizationHeader(options.authorizationHeader, "OAuth introspection authorization");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = boundedTimeout(options.timeoutMs);

  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      const response = await fetchImpl(options.introspectionUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: options.authorizationHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`OAuth introspection request failed (${response.status})`);

      const payload = await jsonRecord(response, "OAuth introspection");
      if (payload.active !== true) throw invalidToken("OAuth access token is inactive");
      const subject = stringField(payload, "sub");
      const expiresAt = numberField(payload, "exp");
      if (!subject || !expiresAt) throw invalidToken("OAuth introspection response is missing sub or exp");
      if (expiresAt <= Math.floor(Date.now() / 1000)) throw invalidToken("OAuth access token is expired");

      const resource = tokenResource(payload, options.resourceServerUrl);

      const clientId = stringField(payload, "client_id") ?? subject;
      return {
        token,
        clientId,
        scopes: scopeList(payload.scope),
        expiresAt,
        ...(resource ? { resource: new URL(resource) } : {}),
        extra: { subject },
      };
    },
  };
}

export function createHttpTenantResolver(options: HttpTenantResolverOptions): PiapiMcpTenantResolver {
  assertSecureServiceUrl(options.brokerUrl, "MCP tenant broker URL");
  assertAuthorizationHeader(options.authorizationHeader, "MCP tenant broker authorization");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = boundedTimeout(options.timeoutMs);

  return {
    async resolve(auth): Promise<PiapiMcpTenant> {
      const subject = typeof auth.extra?.subject === "string" ? auth.extra.subject : auth.clientId;
      const response = await fetchImpl(options.brokerUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: options.authorizationHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject,
          client_id: auth.clientId,
          scopes: auth.scopes,
          expires_at: auth.expiresAt,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`MCP tenant broker request failed (${response.status})`);

      const payload = await jsonRecord(response, "MCP tenant broker");
      const apiKey = stringField(payload, "api_key");
      if (!apiKey) throw new Error("MCP tenant broker did not return a delegated PiAPI credential");
      const apiBaseUrl = stringField(payload, "api_base_url");
      if (apiBaseUrl) assertSecureServiceUrl(new URL(apiBaseUrl), "PiAPI API base URL");
      return { apiKey, ...(apiBaseUrl ? { apiBaseUrl } : {}) };
    },
  };
}

function assertSecureServiceUrl(url: URL, name: string): void {
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} cannot contain credentials, a query string, or a fragment`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return;
  throw new Error(`${name} must use HTTPS outside local loopback testing`);
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 10_000;
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error("Service adapter timeout must be an integer between 1000 and 60000 milliseconds");
  }
  return value;
}

function assertAuthorizationHeader(value: string, name: string): void {
  if (!/^Bearer\s+\S+$/i.test(value)) throw new Error(`${name} must be a non-empty Bearer token`);
}

async function jsonRecord(response: Response, source: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${source} returned non-JSON data`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`${source} returned an invalid response`);
  }
  return payload as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function scopeList(value: unknown): string[] {
  const scopes = Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string")
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
}

function tokenResource(value: Record<string, unknown>, serverUrl: URL): string | undefined {
  const resource = stringField(value, "resource");
  if (resource) {
    try {
      if (sameResource(new URL(resource), serverUrl)) return resource;
    } catch {
      // The invalid-token response below intentionally does not reflect a
      // malformed attacker-controlled resource value.
    }
    throw invalidToken("OAuth access token is not valid for this MCP resource");
  }
  if (value.aud === undefined) return undefined;
  return audienceResource(value.aud, serverUrl);
}

function audienceResource(value: unknown, serverUrl: URL): string {
  const audiences = Array.isArray(value) ? value : [value];
  for (const audience of audiences) {
    if (typeof audience !== "string") continue;
    try {
      const url = new URL(audience);
      if (sameResource(url, serverUrl)) return url.href;
    } catch {
      // Ignore malformed audience members; only an exact expected resource
      // can authorize this endpoint.
    }
  }
  throw invalidToken("OAuth access token audience does not include this MCP resource");
}

function sameResource(a: URL, b: URL): boolean {
  const left = new URL(a);
  const right = new URL(b);
  left.hash = "";
  right.hash = "";
  return left.href === right.href;
}

function invalidToken(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}
