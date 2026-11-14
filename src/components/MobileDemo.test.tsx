// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MobileDemo } from "./MobileDemo";

let container: HTMLDivElement;
let root: Root;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function buttonContaining(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find(candidate => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button containing "${label}" was not found.`);
  return button;
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Could not access the native value setter.");
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("mobile interface preview interactions", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<MobileDemo />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("navigates between the primary mobile sections", () => {
    act(() => buttonContaining("Проекты").click());
    expect(container.textContent).toContain("Твои проекты");

    act(() => buttonContaining("Память").click());
    expect(container.textContent).toContain("Память NEXUS");

    act(() => buttonContaining("Настройки").click());
    expect(container.textContent).toContain("SYSTEM CONTROL");
  });

  it("opens secondary modules from the More section", () => {
    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("База знаний").click());
    expect(container.textContent).toContain("PROJECT KNOWLEDGE");

    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("Файловая система").click());
    expect(container.textContent).toContain("DEVICE WORKSPACE");
  });

  it("sends a local demo message without contacting an AI model", () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Сообщение"]');
    if (!input) throw new Error("Chat composer input was not found.");
    setInputValue(input, "Проверь работу мобильного интерфейса");

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Отправить сообщение"]')?.click());

    expect(container.textContent).toContain("Проверь работу мобильного интерфейса");
    expect(container.textContent).toContain("сообщение не отправлялось AI-модели");
    expect(input.value).toBe("");
  });

  it("makes preview-only agent actions explicit", () => {
    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("Агенты").click());
    const task = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Тестовая задача для агента"]');
    if (!task) throw new Error("Agent demo task field was not found.");
    setInputValue(task, "Проверить тестовый сценарий");
    act(() => buttonContaining("Запустить демо").click());

    expect(container.textContent).toContain("задача не отправлялась агенту и не выполнялась");
  });

  it("does not allow an empty demo message to create a notice", () => {
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Отправить сообщение"]')?.click());
    expect(container.textContent).not.toContain("сообщение не отправлялось AI-модели");
  });

  it("opens every secondary module from the mobile module hub", () => {
    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("Tools & MCP").click());
    expect(container.textContent).toContain("TOOL GATEWAY");

    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("Training Lab").click());
    expect(container.textContent).toContain("MODEL DEVELOPMENT");

    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("Агенты").click());
    expect(container.textContent).toContain("NEXUS AUTOMATION");
  });

  it("filters the demo project list and exposes an empty search state", () => {
    act(() => buttonContaining("Проекты").click());
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Поиск проектов"]');
    if (!search) throw new Error("Project search input was not found.");
    setInputValue(search, "no matching project");
    expect(container.textContent).toContain("Проекты не найдены.");
    expect(container.textContent).not.toContain("NEXUS AU");
  });

  it("keeps knowledge search explicitly in preview mode", () => {
    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("База знаний").click());
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Поиск по базе знаний"]');
    if (!search) throw new Error("Knowledge search input was not found.");
    setInputValue(search, "architecture");
    act(() => buttonContaining("Найти").click());
    expect(container.textContent).toContain("Демо-поиск по запросу «architecture»");
    expect(container.textContent).toContain("Реальные документы пока не индексируются");
  });

  it("expands tool details and dismisses preview notices", () => {
    act(() => buttonContaining("Ещё").click());
    act(() => buttonContaining("Tools & MCP").click());
    const browser = buttonContaining("Browser");
    expect(browser.getAttribute("aria-expanded")).toBe("true");
    act(() => browser.click());
    expect(browser.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Требуется: Сетевой доступ");

    act(() => buttonContaining("Настройки").click());
    act(() => buttonContaining("О проекте").click());
    expect(container.textContent).toContain("NEXUS AU — личная AI-экосистема в разработке.");
    const notice = container.querySelector<HTMLButtonElement>(".demo-notice");
    if (!notice) throw new Error("Preview notice was not rendered.");
    act(() => notice.click());
    expect(container.querySelector(".demo-notice")).toBeNull();
  });
});
