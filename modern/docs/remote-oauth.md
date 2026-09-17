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
The PiAPI identity/account service must provide:

1. Authorization Code + PKCE consent and token endpoints;
2. signed JWT validation via JWKS or token introspection;
3. a stable subject/client identity in `AuthInfo`;
4. a server-side subject-to-PiAPI-credential lookup, ideally from an encrypted
   credential store or token exchange rather than plaintext database fields;
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
