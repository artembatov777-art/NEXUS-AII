import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("NEXUS localization", () => {
  it("uses Russian as the default translation language", () => {
    expect(translate("Provider settings", "ru")).toBe("Настройки AI-провайдера");
  });
  it("keeps English text when English is selected", () => {
    expect(translate("Provider settings", "en")).toBe("Provider settings");
  });
  it("does not alter unknown technical identifiers", () => {
    expect(translate("gemini-3.1-flash-lite", "ru")).toBe("gemini-3.1-flash-lite");
  });
});
