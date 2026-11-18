const COOKIE_NAME = "nexus_gateway";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ""; }
  }
  return "";
}

export function isGatewayAuthorized(req, expectedToken) {
  if (typeof expectedToken !== "string" || !expectedToken) return false;
  const authorization = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const candidate = bearer || readCookie(req, COOKIE_NAME);
  return constantTimeEqual(candidate, expectedToken);
}

export function gatewaySessionCookie(token) {
  return COOKIE_NAME + "=" + encodeURIComponent(token) +
    "; Path=/api; Max-Age=" + COOKIE_MAX_AGE + "; HttpOnly; Secure; SameSite=Strict";
}

export function clearGatewaySessionCookie() {
  return COOKIE_NAME + "=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}
