import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app?: { security?: { csp?: string } };
};
const capabilities = JSON.parse(readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8")) as {
  permissions?: string[];
};

function parseCsp(value: string): Map<string, string[]> {
  const entries = value.split(";").map((directive): [string, string[]] => {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    return [name ?? "", sources];
  });
  return new Map(entries);
}

describe("Tauri desktop security boundary", () => {
  it("keeps script execution same-origin with only the WebAssembly compilation exception", () => {
    const csp = config.app?.security?.csp;
    expect(csp).toBeTruthy();
    const directives = parseCsp(csp!);
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("frame-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
  });

  it("limits network connections to IPC, HTTPS, and explicit loopback development/provider endpoints", () => {
    const directives = parseCsp(config.app?.security?.csp ?? "");
    const connect = directives.get("connect-src") ?? [];
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost");
    expect(connect).toContain("https:");
    expect(connect).toContain("http://localhost:*");
    expect(connect).toContain("http://127.0.0.1:*");
    expect(connect).toContain("http://[::1]:*");
    expect(connect).not.toContain("*");
  });

  it("does not grant broad filesystem or shell permissions to the webview", () => {
    expect(capabilities.permissions).toEqual(["core:default", "dialog:allow-open"]);
    expect(capabilities.permissions?.some(permission => /shell|fs:|http:|process|updater/i.test(permission))).toBe(false);
  });
});
