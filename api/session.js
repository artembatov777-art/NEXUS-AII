import { clearGatewaySessionCookie, gatewaySessionCookie, isGatewayAuthorized } from "./_lib/gatewayAuth.js";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Cookie");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const accessToken = process.env.NEXUS_API_TOKEN;
  if (!accessToken) return sendJson(res, 503, { error: "NEXUS API access is not configured." });

  if (req.method === "GET") {
    return sendJson(res, 200, { authenticated: isGatewayAuthorized(req, accessToken) });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearGatewaySessionCookie());
    return sendJson(res, 200, { authenticated: false });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const authorization = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!isGatewayAuthorized({ headers: { authorization: "Bearer " + suppliedToken } }, accessToken)) {
    return sendJson(res, 401, { error: "Unauthorized." });
  }

  res.setHeader("Set-Cookie", gatewaySessionCookie(accessToken));
  return sendJson(res, 200, { authenticated: true });
}
