import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("NEXUS localization", () => {
  it("uses Russian as the default translation language", () => {
    expect(translate("Provider settings", "ru")).toBe("Настройки AI-провайдера");
  });
  it("keeps English text when English is selected", () => {
    expect(translate("Provider settings", "en")).toBe("Provider settings");
  });
  it("translates Russian-origin labels into English without changing Russian mode", () => {\n    expect(translate("Язык интерфейса", "ru")).toBe("Язык интерфейса");\n    expect(translate("Язык интерфейса", "en")).toBe("Interface language");\n    expect(translate("Настройки", "en")).toBe("Settings");\n  });\n  it("does not alter unknown technical identifiers", () => {
    expect(translate("gemini-3.1-flash-lite", "ru")).toBe("gemini-3.1-flash-lite");
  });
});
