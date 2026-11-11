/**
 * Client-side validation for OpenAI-compatible provider endpoints.
 * The native Rust host repeats these checks; this helper only gives faster,
 * clearer feedback before an IPC request is made.
 */
export function providerEndpointError(baseUrl: string): string | null {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl.trim());
  } catch {
    return "Provider URL is invalid.";
  }

  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = hostname === "localhost" || hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);

  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLoopback)) {
    return "Provider URL must use HTTPS. HTTP is allowed only for localhost or loopback IP addresses.";
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return "Provider URL cannot contain credentials, query parameters, or fragments.";
  }
  return null;
}

export function normalizeProviderModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string =>
    typeof id === "string" && id.trim().length > 0 && id.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(id)
  ).map(id => id.trim());
  return [...new Set(ids)];
}
