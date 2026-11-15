import { isGatewayAuthorized } from "./_lib/gatewayAuth.js";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const ALLOWED_MODELS = new Set([
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash"
]);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}


function readBody(req) {
  // Vercel's Node runtime may parse JSON before invoking the function.
  // Prefer that parsed value, but enforce the same byte limit as the raw-stream path.
  if (req.body !== undefined) {
    try {
      if (Buffer.isBuffer(req.body)) {
        if (req.body.byteLength > MAX_BODY_BYTES) {
          return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        }
        return Promise.resolve(JSON.parse(req.body.toString("utf8")));
      }
      if (typeof req.body === "string") {
        if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
          return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        }
        return Promise.resolve(JSON.parse(req.body));
      }
      const serialized = JSON.stringify(req.body);
      if (Buffer.byteLength(serialized, "utf8") > MAX_BODY_BYTES) {
        return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      }
      return Promise.resolve(req.body);
    } catch {
      return Promise.reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
    }
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const contents = [];
  for (const item of value) {
    if (!item || (item.role !== "user" && item.role !== "assistant") ||
        typeof item.content !== "string" || !item.content.trim() ||
        item.content.length > MAX_MESSAGE_CHARS) return null;
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }]
    });
  }
  if (contents[contents.length - 1].role !== "user") return null;
  return contents;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const accessToken = process.env.NEXUS_API_TOKEN;
  if (!apiKey) return sendJson(res, 503, { error: "Gemini provider is not configured." });
  if (!accessToken) return sendJson(res, 503, { error: "NEXUS API access is not configured." });

  if (!isGatewayAuthorized(req, accessToken)) return sendJson(res, 401, { error: "Unauthorized." });

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return sendJson(res, 415, { error: "Content-Type must be application/json." });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message || "Invalid request." });
  }

  const messages = validateMessages(body?.messages);
  if (!messages) return sendJson(res, 400, { error: "Messages must contain 1–40 valid turns and end with a user message." });

  const model = typeof body.model === "string" && ALLOWED_MODELS.has(body.model)
    ? body.model
    : DEFAULT_MODEL;
  const systemInstruction = typeof body.systemInstruction === "string"
    ? body.systemInstruction.slice(0, 24_000)
    : "";
  const generationConfig = {};
  if (Number.isFinite(body.temperature)) generationConfig.temperature = Math.min(2, Math.max(0, body.temperature));
  if (Number.isInteger(body.maxOutputTokens)) generationConfig.maxOutputTokens = Math.min(8192, Math.max(1, body.maxOutputTokens));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: messages,
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
          ...(Object.keys(generationConfig).length ? { generationConfig } : {})
        }),
        signal: controller.signal
      }
    );

    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      return sendJson(res, status, {
        error: status === 429
          ? "Gemini rate limit reached. Try again later."
          : status === 502
            ? "Gemini is temporarily unavailable."
            : "Gemini rejected the request."
      });
    }

    const data = await upstream.json();
    const text = Array.isArray(data?.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .filter(part => typeof part.text === "string")
          .map(part => part.text)
          .join("")
      : "";
    if (!text.trim()) return sendJson(res, 502, { error: "Gemini returned no text response." });

    return sendJson(res, 200, {
      text,
      usage: {
        inputTokens: Number.isFinite(data.usageMetadata?.promptTokenCount) ? data.usageMetadata.promptTokenCount : null,
        outputTokens: Number.isFinite(data.usageMetadata?.candidatesTokenCount) ? data.usageMetadata.candidatesTokenCount : null
      },
      model
    });
  } catch (error) {
    return sendJson(res, error.name === "AbortError" ? 504 : 502, {
      error: error.name === "AbortError" ? "Gemini request timed out." : "Could not reach Gemini."
    });
  } finally {
    clearTimeout(timeout);
  }
}
