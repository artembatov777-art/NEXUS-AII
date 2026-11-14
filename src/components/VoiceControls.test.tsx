// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControls } from "./VoiceControls";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("VoiceControls", () => {
  it("reports unsupported speech recognition instead of pretending to listen", () => {
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    const button = container.querySelector('button[aria-label="Start voice input"]');
    expect(button).not.toBeNull();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("Speech recognition is not supported");
  });

  it("discloses that host speech recognition may use an online service", () => {
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    expect(container.textContent).toContain("Speech recognition may use an online service");
    expect(container.textContent).toContain("Do not dictate sensitive information");
  });

  it("passes final recognized speech to the chat composer callback", () => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onstart?.();
        const result = Object.assign([{ transcript: "hello from voice" }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [result] });
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    const onTranscript = vi.fn();
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="" />));
    const button = container.querySelector('button[aria-label="Start voice input"]');
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onTranscript).toHaveBeenCalledWith("hello from voice");
  });
});
