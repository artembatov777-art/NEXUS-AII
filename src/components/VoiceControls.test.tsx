// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControls } from "./VoiceControls";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
});

describe("VoiceControls", () => {
  it("reports unsupported speech recognition instead of pretending to listen", () => {
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    const button = container.querySelector('button[aria-label="Start voice input"]');
    expect(button).not.toBeNull();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("Speech recognition is not supported");
  });

  it("does not open the microphone for conversation when speech synthesis is unavailable", () => {
    const start = vi.fn();
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class { start = start; } });
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    act(() => container.querySelector('button[aria-label="Start voice conversation"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("Text-to-speech is not supported");
    expect(container.querySelector('button[aria-label="End voice conversation"]')).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("discloses that host speech recognition may use an online service", () => {
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    expect(container.textContent).toContain("Speech recognition may use an online service");
    expect(container.textContent).toContain("Do not dictate sensitive information");
  });


  it("ignores late speech results after push-to-talk has been stopped", () => {
    class FakeRecognition {
      static latest: FakeRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    const onTranscript = vi.fn();
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="" />));
    const start = container.querySelector('button[aria-label="Start voice input"]');
    act(() => start?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const instance = FakeRecognition.latest;
    expect(instance).not.toBeNull();
    const stop = container.querySelector('button[aria-label="Stop voice input"]');
    act(() => stop?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const result = Object.assign([{ transcript: "late transcript" }], { isFinal: true });
    act(() => instance?.onresult?.({ resultIndex: 0, results: [result] }));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it.each(["result", "end", "error"] as const)("ignores a late %s callback after stopping and restarting voice input", callback => {
    class DeferredRecognition {
      static instances: DeferredRecognition[] = [];
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { DeferredRecognition.instances.push(this); }
      start() { this.onstart?.(); }
      // Browser stop/abort completion arrives asynchronously.
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: DeferredRecognition });
    const onTranscript = vi.fn();
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="" />));
    const click = (label: string) => act(() => {
      container.querySelector(`button[aria-label="${label}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    click("Start voice input");
    const old = DeferredRecognition.instances[0];
    click("Stop voice input");
    const finalResult = (text: string) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    if (callback === "result") {
      act(() => old.onresult?.(finalResult("stopped session")));
      expect(onTranscript).not.toHaveBeenCalled();
    }
    click("Start voice input");
    const current = DeferredRecognition.instances[1];
    act(() => {
      if (callback === "end") old.onend?.();
      if (callback === "error") old.onerror?.({ error: "not-allowed" });
    });
    expect(container.querySelector('button[aria-label="Stop voice input"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    act(() => current.onresult?.(finalResult("current session")));
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith("current session", false);
  });

  it("submits recognized speech automatically in voice conversation mode", () => {
    class FakeRecognition {
      static latest: FakeRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    class FakeUtterance {
      text: string;
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    const speech = Object.assign(new EventTarget(), {
      getVoices: () => [],
      speak: vi.fn(),
      cancel: vi.fn()
    });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    const onTranscript = vi.fn();
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="" />));
    const button = container.querySelector('button[aria-label="Start voice conversation"]');
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const instance = FakeRecognition.latest;
    expect(instance).not.toBeNull();
    const result = Object.assign([{ transcript: "send this to NEXUS" }], { isFinal: true });
    act(() => {
      instance?.onresult?.({ resultIndex: 0, results: [result] });
      instance?.onresult?.({ resultIndex: 0, results: [result] });
    });
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("send this to NEXUS", true);
  });

  it.each(["completion", "interruption"])("resumes listening after speech %s and ignores late speech callbacks", outcome => {
    class FakeRecognition {
      static latest: FakeRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    class FakeUtterance {
      text: string;
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    const speech = Object.assign(new EventTarget(), {
      getVoices: () => [],
      speak: vi.fn(),
      cancel: vi.fn()
    });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    const onTranscript = vi.fn();
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="" />));
    const button = container.querySelector('button[aria-label="Start voice conversation"]');
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const firstRecognition = FakeRecognition.latest;
    const result = Object.assign([{ transcript: "read the answer" }], { isFinal: true });
    act(() => firstRecognition?.onresult?.({ resultIndex: 0, results: [result] }));
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="" isGenerating={true} />));
    act(() => root.render(<VoiceControls onTranscript={onTranscript} textToSpeak="NEXUS is ready." isGenerating={false} />));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    const spoken = vi.mocked(speech.speak).mock.calls[0]?.[0] as FakeUtterance;
    expect(spoken.text).toBe("NEXUS is ready.");
    if (outcome === "interruption") {
      const stopReading = container.querySelector('button[aria-label="Stop reading"]');
      expect(stopReading).not.toBeNull();
      act(() => stopReading?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    } else {
      act(() => spoken.onend?.());
    }
    const resumed = FakeRecognition.latest;
    expect(resumed).not.toBe(firstRecognition);
    act(() => { spoken.onerror?.(); spoken.onend?.(); });
    expect(FakeRecognition.latest).toBe(resumed);
    expect(container.querySelector('button[aria-label="End voice conversation"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("stops recognition and speech when voice conversation is ended", () => {
    class FakeRecognition {
      static latest: FakeRecognition | null = null;
      abort = vi.fn(() => this.onend?.());
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
    }
    const speech = Object.assign(new EventTarget(), { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(public text: string) {} } });
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    const start = container.querySelector('button[aria-label="Start voice conversation"]');
    act(() => start?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const active = FakeRecognition.latest;
    expect(active).not.toBeNull();
    const stop = container.querySelector('button[aria-label="End voice conversation"]');
    act(() => stop?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(active?.abort).toHaveBeenCalledTimes(1);
    expect(speech.cancel).toHaveBeenCalled();
    expect(container.textContent).not.toContain("End conversation");
  });

  it("aborts active speech recognition when the voice controls unmount", () => {
    class FakeRecognition {
      static latest: FakeRecognition | null = null;
      abort = vi.fn();
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
    }
    const speech = Object.assign(new EventTarget(), { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    const start = container.querySelector('button[aria-label="Start voice input"]');
    act(() => start?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const active = FakeRecognition.latest;
    expect(active).not.toBeNull();
    act(() => {
      root.unmount();
      root = createRoot(container);
    });
    expect(active?.abort).toHaveBeenCalledTimes(1);
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("ends voice conversation and reports microphone permission denial", () => {
    class FakeRecognition {
      static latest: FakeRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    const speech = Object.assign(new EventTarget(), { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(public text: string) {} } });
    act(() => root.render(<VoiceControls onTranscript={vi.fn()} textToSpeak="" />));
    const start = container.querySelector('button[aria-label="Start voice conversation"]');
    act(() => start?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => FakeRecognition.latest?.onerror?.({ error: "not-allowed" }));
    expect(container.textContent).toContain("Microphone access was denied");
    expect(container.textContent).not.toContain("End conversation");
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
    expect(onTranscript).toHaveBeenCalledWith("hello from voice", false);
  });
});
