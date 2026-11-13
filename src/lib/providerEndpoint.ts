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
  const ipv4Parts = hostname.split(".");
  const isLoopbackIpv4 = ipv4Parts.length === 4 && ipv4Parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255) && Number(ipv4Parts[0]) === 127;
  const isLoopback = hostname === "localhost" || hostname === "::1" || isLoopbackIpv4;

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
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const id = candidate.trim();
    if (!id || new TextEncoder().encode(id).byteLength > 128 ||
        /[\u0000-\u001f\u007f]/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 500) break;
  }
  return ids;
}


export interface NormalizedProviderFailure {
  code: "authentication" | "rate_limited" | "timeout" | "validation" | "cancelled" | "provider_unavailable";
  message: string;
  retryable: boolean;
}

/** Converts native gateway failures into stable application-level categories. */
export function normalizeProviderFailure(cause: unknown): NormalizedProviderFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  const status = message.match(/HTTP\s+(\d{3})/i)?.[1];
  if (/cancelled|canceled|aborted/i.test(message)) {
    return { code: "cancelled", message: "The provider request was cancelled.", retryable: false };
  }
  if (status === "401" || status === "403") {
    return { code: "authentication", message: "The provider rejected the saved credentials. Check the API key and its permissions.", retryable: false };
  }
  if (status === "429") {
    return { code: "rate_limited", message: "The provider rate limit was reached. Wait briefly before retrying.", retryable: true };
  }
  if (status === "408" || status === "504" || /timed? ?out|timeout/i.test(message)) {
    return { code: "timeout", message: "The provider request timed out. Check the gateway and try again.", retryable: true };
  }
  if (status && Number(status) >= 500) {
    return { code: "provider_unavailable", message: "The provider is temporarily unavailable. Try again later.", retryable: true };
  }
  if (status && ["400", "404", "422"].includes(status)) {
    return { code: "validation", message: "The provider rejected the endpoint or model configuration. Check the URL and model ID.", retryable: false };
  }
  if (/URL is invalid|must use HTTPS|cannot contain credentials|model name is invalid/i.test(message)) {
    return { code: "validation", message, retryable: false };
  }
  return { code: "provider_unavailable", message: "Could not reach the configured provider. Check that the gateway is running and try again.", retryable: true };
}


/** True only when the configured endpoint resolves to a loopback host. */
export function isLoopbackProviderEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1") return true;
    const parts = hostname.split(".");
    return parts.length === 4 &&
      parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
      Number(parts[0]) === 127;
  } catch {
    return false;
  }
}
