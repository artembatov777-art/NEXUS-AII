// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runtime, createRuntime } = vi.hoisted(() => {
  const runtime = {
    connectMcpHttp: vi.fn(async () => ({ ok: true as const, value: { serverId: "demo", protocolVersion: "2024-11-05" } })),
    mcpClient: {
      listTools: vi.fn(async () => ({ ok: true as const, value: [{ name: "lookup" }] })),
      disconnect: vi.fn(async () => undefined)
    }
  };
  return { runtime, createRuntime: vi.fn(() => runtime) };
});
vi.mock("../lib/nexusRuntime", () => ({ createWorkspaceNexusRuntime: createRuntime }));

import { ToolsPanel } from "./ToolsPanel";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function inputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => { setter?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("ToolsPanel MCP management", () => {
  it("saves a secure endpoint, initializes a session, discovers tools and shows live status", async () => {
    await act(async () => { root.render(<ToolsPanel onClose={onClose} />); });
    inputValue(container.querySelector<HTMLInputElement>('[aria-label="MCP server name"]')!, "Demo server");
    inputValue(container.querySelector<HTMLInputElement>('[aria-label="MCP endpoint URL"]')!, "https://mcp.example.com/rpc");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Save & connect"))!.click(); });
    expect(window.localStorage.getItem("nexus-au:mcp-servers:v1")).toContain("https://mcp.example.com/rpc");
    expect(runtime.connectMcpHttp).toHaveBeenCalledWith({ id: "demo-server", name: "Demo server", endpoint: "https://mcp.example.com/rpc", version: "1" }, expect.any(AbortSignal));
    expect(runtime.mcpClient.listTools).toHaveBeenCalledWith("demo-server", expect.any(AbortSignal));
    expect(container.textContent).toContain("CONNECTED · 1 TOOLS");
  });

  it("disconnects and removes a saved endpoint", async () => {
    window.localStorage.setItem("nexus-au:mcp-servers:v1", JSON.stringify([{ id: "demo-server", name: "Demo server", endpoint: "https://mcp.example.com/rpc" }]));
    await act(async () => { root.render(<ToolsPanel onClose={onClose} />); });
    expect(runtime.connectMcpHttp).toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Remove Demo server"]')!.click(); });
    expect(runtime.mcpClient.disconnect).toHaveBeenCalledWith("demo-server");
    expect(JSON.parse(window.localStorage.getItem("nexus-au:mcp-servers:v1") ?? "[]")).toEqual([]);
  });

  it("reconnects by replacing the existing session instead of failing as a duplicate", async () => {
    window.localStorage.setItem("nexus-au:mcp-servers:v1", JSON.stringify([{ id: "demo-server", name: "Demo server", endpoint: "https://mcp.example.com/rpc" }]));
    await act(async () => { root.render(<ToolsPanel onClose={onClose} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Reconnect Demo server"]')!.click(); });
    expect(runtime.mcpClient.disconnect).toHaveBeenCalledWith("demo-server");
    expect(runtime.connectMcpHttp).toHaveBeenCalledTimes(2);
  });
});
