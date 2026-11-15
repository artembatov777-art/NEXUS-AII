import { afterEach, beforeEach, describe, expect, it } from "vitest";
import handler from "../../api/session.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
    json() { return JSON.parse(this.body); }
  };
}

function request(method = "GET", headers = {}) {
  return { method, headers };
}

describe("NEXUS browser session", () => {
  beforeEach(() => vi.stubEnv("NEXUS_API_TOKEN", "one-stable-owner-token"));
  afterEach(() => vi.unstubAllEnvs());

  it("exchanges the shared token for a secure HttpOnly cookie", async () => {
    const res = response();
    await handler(request("POST", { authorization: "Bearer one-stable-owner-token" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(res.headers["Set-Cookie"]).toContain("Secure");
    expect(res.headers["Set-Cookie"]).toContain("SameSite=Strict");
    expect(res.headers["Set-Cookie"]).not.toContain("Max-Age=0");
  });

  it("rejects an incorrect token without creating a cookie", async () => {
    const res = response();
    await handler(request("POST", { authorization: "Bearer wrong" }), res);
    expect(res.statusCode).toBe(401);
    expect(res.headers["Set-Cookie"]).toBeUndefined();
  });

  it("recognizes a remembered device without exposing the token to JavaScript", async () => {
    const res = response();
    await handler(request("GET", { cookie: "theme=dark; nexus_gateway=one-stable-owner-token" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
  });

  it("clears only the current device session", async () => {
    const res = response();
    await handler(request("DELETE"), res);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: false });
    expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
  });
});
