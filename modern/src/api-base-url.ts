const DEFAULT_PIAPI_API_BASE_URL = "https://api.piapi.ai/api/v1";

/**
 * Resolves the optional API override used by the modern stdio entrypoint.
 *
 * A HTTPS endpoint is always allowed. Plain HTTP is deliberately limited to
 * the two loopback forms used by the local host smoke test, so an accidental
 * environment override cannot send a PiAPI API key to a network HTTP service.
 */
export function apiBaseUrlFromEnvironment(value: string | undefined): string | undefined {
  if (!value) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PIAPI_API_BASE_URL must be an absolute HTTPS URL, or an HTTP localhost URL for local testing");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("PIAPI_API_BASE_URL cannot contain credentials, a query string, or a fragment");
  }

  const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("PIAPI_API_BASE_URL must use HTTPS; HTTP is only permitted for localhost or 127.0.0.1 local testing");
  }

  return url.href.replace(/\/$/, "");
}

export { DEFAULT_PIAPI_API_BASE_URL };
