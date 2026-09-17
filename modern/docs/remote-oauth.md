# Remote HTTPS, OAuth, and tenant isolation

The local stdio entrypoint is intentionally separate from remote deployment.
For ChatGPT and other hosted MCP clients, use the remote handler in
`modern/src/remote.ts` behind a public HTTPS endpoint.

## What is implemented

`createPiapiAppsRemoteHandler` provides the MCP Resource Server half of the
deployment:

- Streamable HTTP via the official MCP HTTP handler;
- RFC 9728 protected-resource metadata and authorization-server metadata;
- Bearer-token verification through an injected `OAuthTokenVerifier`;
- scope enforcement (`mcp` by default);
- host-header validation, with optional Origin allowlisting;
- a fresh MCP server per authenticated HTTP request;
- a tenant resolver that obtains the PiAPI credential only after the bearer
  token is validated.

The handler does not accept a PiAPI key from a browser, tool input, or
unauthenticated HTTP header. It never returns tenant credentials in MCP
results or UI data.

## Required production integration

This repository does **not** become an OAuth Authorization Server by itself.
It includes two HTTPS service adapters:

- `createHttpOAuthTokenVerifier` uses RFC 7662-style token introspection and
  maps `sub`, `client_id`, `scope`, `exp`, and the resource audience into the
  MCP SDK authentication context.
- `createHttpTenantResolver` calls a trusted tenant broker with the validated
  subject and scopes; the broker returns a server-only delegated PiAPI
  credential for that authorized request.

The deployable `modern/src/remote-index.ts` entrypoint wires those adapters
from environment references. It refuses to start if public URLs are not HTTPS
or service-to-service authorization values are absent. Start it after build
with `npm --prefix modern run start:remote`.

The PiAPI identity/account service must provide:

1. Authorization Code + PKCE consent and token endpoints;
2. signed JWT validation via JWKS or token introspection;
3. a stable subject/client identity in `AuthInfo`;
4. a server-side tenant broker that maps the validated subject to a delegated
   PiAPI credential, ideally via token exchange or an encrypted credential
   store rather than plaintext database fields;
5. token revocation and credential-deletion handling.

Wire those components into the handler with:

```ts
createPiapiAppsRemoteHandler({
  resourceServerUrl: new URL("https://mcp.example.com/mcp"),
  authMetadata,
  tokenVerifier,
  tenantResolver,
});
```

`tokenVerifier` must reject expired/revoked tokens and populate `expiresAt`.
`tenantResolver` must authorize the subject before returning an API credential.
Do not replace either integration with a static environment token in a public
deployment.

The default entrypoint expects these deployment-secret references:

```text
PIAPI_MCP_PUBLIC_URL=https://mcp.example.com/mcp
PIAPI_MCP_OAUTH_ISSUER=https://accounts.example.com
PIAPI_MCP_OAUTH_AUTHORIZATION_ENDPOINT=https://accounts.example.com/authorize
PIAPI_MCP_OAUTH_TOKEN_ENDPOINT=https://accounts.example.com/token
PIAPI_MCP_OAUTH_INTROSPECTION_URL=https://accounts.example.com/introspect
PIAPI_MCP_OAUTH_INTROSPECTION_AUTHORIZATION=Bearer <service credential>
PIAPI_MCP_TENANT_BROKER_URL=https://identity-internal.example.com/mcp/tenant
PIAPI_MCP_TENANT_BROKER_AUTHORIZATION=Bearer <service credential>
```

The two authorization values are deployment secrets; do not place literal
values in client configuration, repository files, or public documentation.

## Deployment posture

- Public endpoint: HTTPS reverse proxy terminates TLS, forwards only to the
  remote handler, and preserves the public `Host` header.
- Per-request handling is stateless; horizontal scaling does not retain a
  previous tenant's PiAPI key in an MCP session.
- The resource URL, OAuth issuer, and discovery metadata must be public,
  stable HTTPS URLs. Loopback HTTP is used only by the self-test.
- Viewer re-signing remains a server-side tenant-authorized operation keyed by
  `taskId`; raw artifact URLs are not forwarded to the viewer.

## Verification

`npm --prefix modern run test` includes a remote E2E test that starts:

1. a mock PiAPI task API;
2. an authenticated local Streamable HTTP endpoint;
3. an official MCP HTTP client with a temporary bearer token.

It verifies protected-resource discovery, a `401` challenge without a token,
tool listing/calling with a valid token, and that the resolver-selected tenant
credential—not a client-provided value—is sent upstream.
