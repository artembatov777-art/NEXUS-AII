import { isGatewayAuthorized } from "../server/gatewayAuth.js";
import {
  loadProviderProfilesFromServer,
  saveProviderProfilesToServer
} from "../server/providerProfileStore.js";

const MAX_BODY_BYTES = 32 * 1024;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Cookie");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return req.body;
    return JSON.stringify(req.body);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function handleStoreError(res, error) {
  if (error?.code === "STORAGE_NOT_CONFIGURED") {
    return sendJson(res, 503, { error: error.message, code: error.code });
  }
  console.error("[NEXUS profile storage]", error);
  return sendJson(res, 500, { error: "Saved provider profiles could not be accessed." });
}

export default async function handler(req, res) {
  const accessToken = process.env.NEXUS_API_TOKEN;
  if (!accessToken) return sendJson(res, 503, { error: "NEXUS API access is not configured." });
  if (!isGatewayAuthorized(req, accessToken)) return sendJson(res, 401, { error: "Unauthorized." });

  if (req.method === "GET") {
    try {
      const store = await loadProviderProfilesFromServer();
      return sendJson(res, 200, { schemaVersion: 1, ...store });
    } catch (error) {
      return handleStoreError(res, error);
    }
  }

  if (req.method === "PUT") {
    let payload;
    try {
      const raw = await readBody(req);
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
        return sendJson(res, 413, { error: "Request body is too large." });
      }
      payload = JSON.parse(raw);
    } catch (error) {
      return sendJson(res, error?.statusCode || 400, { error: error?.statusCode === 413 ? error.message : "Request body must contain valid JSON." });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        payload.schemaVersion !== 1 || !Array.isArray(payload.profiles) ||
        (payload.deletedProfileIds !== undefined && !Array.isArray(payload.deletedProfileIds))) {
      return sendJson(res, 400, { error: "Provider profile payload has an unsupported schema." });
    }
    try {
      const store = await saveProviderProfilesToServer(payload.profiles, payload.deletedProfileIds ?? []);
      return sendJson(res, 200, { schemaVersion: 1, ...store, saved: true });
    } catch (error) {
      if (error?.code === "STORAGE_NOT_CONFIGURED") return handleStoreError(res, error);
      return sendJson(res, 400, { error: error instanceof Error ? error.message : "Provider profiles are invalid." });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return sendJson(res, 405, { error: "Method not allowed." });
}
