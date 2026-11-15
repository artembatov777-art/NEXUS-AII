import { isGatewayAuthorized } from "../../server/gatewayAuth.js";
export const config = { maxDuration: 60 };
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_SYSTEM_CHARS = 24_000;
const PROVIDERS = Object.freeze({
  openai: { baseUrl: "https://api.openai.com/v1", keyName: "OPENAI_API_KEY" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyName: "GEMINI_API_KEY" },
  xai: { baseUrl: "https://api.x.ai/v1", keyName: "XAI_API_KEY" },
  deepseek: { baseUrl: "https://api.deepseek.com", keyName: "DEEPSEEK_API_KEY" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", keyName: "MISTRAL_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", keyName: "OPENROUTER_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", keyName: "GROQ_API_KEY" },
  sambanova: { baseUrl: "https://api.sambanova.ai/v1", keyName: "SAMBANOVA_API_KEY" },
  nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", keyName: "NVIDIA_API_KEY" },
  omniroute: { baseUrl: "", keyName: "OMNIROUTE_API_KEY", hostedEndpoint: true }
});
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  if (req.body !== undefined) {
    try {
      if (Buffer.isBuffer(req.body)) {
        if (req.body.byteLength > MAX_BODY_BYTES) return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return Promise.resolve(JSON.parse(req.body.toString("utf8")));
      }
      if (typeof req.body === "string") {
        if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return Promise.resolve(JSON.parse(req.body));
      }
      if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > MAX_BODY_BYTES) return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
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
      if (size > MAX_BODY_BYTES) { tooLarge = true; chunks.length = 0; }
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}
function resolveProvider(req) {
  const candidate = typeof req.query?.provider === "string"
    ? req.query.provider
    : typeof req.url === "string"
      ? new URL(req.url, "https://nexus.invalid").pathname.split("/").filter(Boolean).at(-1)
      : "";
  return Object.hasOwn(PROVIDERS, candidate)
    ? { id: candidate, ...PROVIDERS[candidate], ...(candidate === "omniroute" ? { baseUrl: process.env.OMNIROUTE_BASE_URL || "" } : {}) }
    : null;
}
function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const messages = [];
  let systemCount = 0;
  for (const item of value) {
    if (!item || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string" || !item.content.trim()) return null;
    if (item.role === "system") {
      systemCount += 1;
      if (systemCount > 1 || item.content.length > MAX_SYSTEM_CHARS) return null;
    } else if (item.content.length > MAX_MESSAGE_CHARS) return null;
    messages.push({ role: item.role, content: item.content });
  }
  if (messages[messages.length - 1].role !== "user") return null;
  return messages;
}
function boundedNumber(value, minimum, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : undefined;
}
function extractText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(part => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "").join("");
}
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  const accessToken = process.env.NEXUS_API_TOKEN;
  if (!accessToken) return sendJson(res, 503, { error: "NEXUS API access is not configured." });
  if (!isGatewayAuthorized(req, accessToken)) return sendJson(res, 401, { error: "Unauthorized." });
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return sendJson(res, 415, { error: "Content-Type must be application/json." });
  const provider = resolveProvider(req);
  if (!provider) return sendJson(res, 404, { error: "Unsupported hosted provider." });
  const apiKey = process.env[provider.keyName];
  if (!apiKey) return sendJson(res, 503, { error: "This provider is not configured in the NEXUS server environment." });
  let baseUrl = provider.baseUrl;
  if (provider.hostedEndpoint) {
    try {
      const endpoint = new URL(baseUrl);
      const host = endpoint.hostname.toLowerCase();
      const privateHost = host === "localhost" || host === "::1" || host === "[::1]" ||
        /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);
      if (endpoint.protocol !== "https:" || privateHost || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash || !/\/v1\/?$/.test(endpoint.pathname)) {
        return sendJson(res, 503, { error: "OmniRoute requires a public HTTPS /v1 endpoint configured by the deployment owner." });
      }
      baseUrl = endpoint.toString().replace(/\/$/, "");
    } catch {
      return sendJson(res, 503, { error: "OmniRoute requires a public HTTPS /v1 endpoint configured by the deployment owner." });
    }
  }
  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: error.message || "Invalid request." }); }
  if (body?.action !== "models" && body?.action !== "chat") return sendJson(res, 400, { error: "Action must be models or chat." });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), body.action === "models" ? 15_000 : 45_000);
  try {
    if (body.action === "models") {
      const upstream = await fetch(baseUrl + "/models", {
        method: "GET",
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        signal: controller.signal
      });
      if (!upstream.ok) {
        const status = upstream.status === 401 || upstream.status === 403 ? 401 : upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
        return sendJson(res, status, { error: status === 401 ? "The provider rejected its configured credentials." : status === 429 ? "The provider rate limit was reached." : status === 502 ? "The provider is temporarily unavailable." : "The provider rejected the model-catalog request." });
      }
      const data = await upstream.json();
      const seen = new Set();
      const models = Array.isArray(data?.data) ? data.data.flatMap(item => {
        const id = typeof item?.id === "string" ? item.id.trim() : "";
        if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id) || seen.has(id)) return [];
        seen.add(id);
        return [id];
      }).slice(0, 200) : [];
      if (!models.length) return sendJson(res, 502, { error: "The provider returned no usable model IDs." });
      return sendJson(res, 200, { provider: provider.id, models });
    }
    const messages = validateMessages(body.messages);
    if (!messages) return sendJson(res, 400, { error: "Messages must contain 1–40 valid turns, with at most one system message, and end with a user message." });
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) return sendJson(res, 400, { error: "A valid model ID is required." });
    const requestBody = { model, messages };
    const temperature = boundedNumber(body.temperature, 0, 2);
    const maxTokens = Number.isInteger(body.maxOutputTokens) ? Math.min(8192, Math.max(1, body.maxOutputTokens)) : undefined;
    if (temperature !== undefined) requestBody.temperature = temperature;
    if (maxTokens !== undefined) requestBody.max_tokens = maxTokens;
    const headers = { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", Accept: "application/json" };
    if (provider.id === "openrouter") {
      headers["X-Title"] = "NEXUS AU";
      if (process.env.NEXUS_PUBLIC_URL) headers["HTTP-Referer"] = process.env.NEXUS_PUBLIC_URL;
    }
    const upstream = await fetch(baseUrl + "/chat/completions", {
      method: "POST", headers, body: JSON.stringify(requestBody), signal: controller.signal
    });
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 401 : upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      return sendJson(res, status, { error: status === 401 ? "The provider rejected its configured credentials." : status === 429 ? "The provider rate limit was reached." : status === 502 ? "The provider is temporarily unavailable." : "The provider rejected the model or generation request." });
    }
    const data = await upstream.json();
    const text = extractText(data?.choices?.[0]?.message?.content);
    if (!text.trim()) return sendJson(res, 502, { error: "The provider returned an empty text response." });
    return sendJson(res, 200, {
      text,
      usage: {
        inputTokens: Number.isFinite(data.usage?.prompt_tokens) ? data.usage.prompt_tokens : null,
        outputTokens: Number.isFinite(data.usage?.completion_tokens) ? data.usage.completion_tokens : null
      },
      model
    });
  } catch (error) {
    return sendJson(res, error.name === "AbortError" ? 504 : 502, { error: error.name === "AbortError" ? "The provider request timed out." : "Could not reach the configured provider." });
  } finally {
    clearTimeout(timeout);
  }
}
