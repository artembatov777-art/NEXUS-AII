# Vercel Gemini API

The Vercel function at `/api/gemini` proxies text generation to the Gemini API. The Google API key stays server-side and is sent in the `x-goog-api-key` header, never in a URL or browser bundle.

## Required Vercel environment variables

- `GEMINI_API_KEY`: the key created in Google AI Studio.
- `NEXUS_API_TOKEN`: a separate, high-entropy access token used by the NEXUS client. Do not reuse the Gemini key.

Add both variables to the Vercel environments that will serve the function, then redeploy. The endpoint returns 503 until both variables exist.

## Request

```http
POST /api/gemini
Authorization: Bearer <NEXUS_API_TOKEN>
Content-Type: application/json
```

```json
{
  "model": "gemini-3.1-flash-lite",
  "messages": [
    { "role": "user", "content": "Reply with NEXUS_OK." }
  ],
  "temperature": 0.2,
  "maxOutputTokens": 512
}
```

Allowed models: `gemini-3.1-flash-lite` and `gemini-3.8-flash`. The function validates request size and message shape, limits the message count, bounds generation settings, applies a 30-second upstream timeout, and does not return upstream error bodies or credentials.

## Security note

The access token is an additional shared-secret gate, not a complete user identity system or durable rate limiter. Do not expose it in public source code, public screenshots, or a committed frontend bundle. Before enabling this endpoint for unrestricted public use, add per-user authentication and persistent rate limiting/quotas. The current desktop Tauri provider flow remains unchanged.
