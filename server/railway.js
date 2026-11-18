import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sessionHandler from "../api/session.js";
import profilesHandler from "../api/profiles.js";
import geminiHandler from "../api/gemini.js";
import geminiImageHandler from "../api/gemini-image.js";
import providerHandler from "../api/provider/[provider].js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_DIR = path.resolve(__dirname, "../dist");

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm"
});

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function setCommonHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

async function serveStatic(req, res, pathname, staticDir) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: "Invalid URL path." });
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const candidate = path.resolve(staticDir, relativePath);
  if (candidate !== staticDir && !candidate.startsWith(staticDir + path.sep)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  let filePath = candidate;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    // A missing extension-less route is handled by the SPA fallback below.
  }

  let contents;
  try {
    contents = await readFile(filePath);
  } catch {
    if (path.extname(decodedPath)) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    try {
      filePath = path.join(staticDir, "index.html");
      contents = await readFile(filePath);
    } catch {
      sendJson(res, 503, { error: "NEXUS frontend build is missing. Run npm run build before starting the service." });
      return;
    }
  }

  const extension = path.extname(filePath).toLowerCase();
  const isHtml = extension === ".html";
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Length": contents.length
  });
  if (req.method === "HEAD") res.end();
  else res.end(contents);
}

export function createNexusServer({ staticDir = DEFAULT_STATIC_DIR } = {}) {
  const resolvedStaticDir = path.resolve(staticDir);

  return createServer(async (req, res) => {
    setCommonHeaders(res);

    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://nexus.internal");
    } catch {
      sendJson(res, 400, { error: "Invalid request URL." });
      return;
    }

    const pathname = requestUrl.pathname.replace(/\/{2,}/g, "/");

    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        service: "nexus-au",
        timestamp: new Date().toISOString()
      });
      return;
    }

    let handler;
    if (pathname === "/api/session") handler = sessionHandler;
    else if (pathname === "/api/profiles") handler = profilesHandler;
    else if (pathname === "/api/gemini") handler = geminiHandler;
    else if (pathname === "/api/gemini-image") handler = geminiImageHandler;
    else if (/^\/api\/provider\/[a-z0-9_-]+$/i.test(pathname)) handler = providerHandler;

    if (pathname.startsWith("/api/")) {
      if (!handler) {
        sendJson(res, 404, { error: "API route not found." });
        return;
      }
      try {
        await handler(req, res);
      } catch (error) {
        if (!res.headersSent) sendJson(res, 500, { error: "Internal server error." });
        else if (!res.writableEnded) res.end();
        // Keep details in server logs only; never return secrets or stack traces.
        console.error("[NEXUS API]", error);
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    await serveStatic(req, res, pathname, resolvedStaticDir);
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be a valid TCP port.");
    process.exit(1);
  }

  const server = createNexusServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`NEXUS AU server listening on 0.0.0.0:${port}`);
  });

  const shutdown = signal => {
    console.log(`Received ${signal}; shutting down NEXUS AU.`);
    server.close(error => {
      if (error) {
        console.error("Graceful shutdown failed:", error);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
