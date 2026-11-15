import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("NEXUS localization", () => {
  it("uses Russian as the default translation language", () => {
    expect(translate("Provider settings", "ru")).toBe("Настройки AI-провайдера");
    expect(translate("Your intelligence. Connected.", "ru")).toBe("Твой интеллект. Всё связано.");
  });

  it("keeps English source text when English is selected", () => {
    expect(translate("Provider settings", "en")).toBe("Provider settings");
    expect(translate("Your intelligence. Connected.", "en")).toBe("Your intelligence. Connected.");
  });

  it("translates Russian-origin labels into English without changing Russian mode", () => {
    expect(translate("Язык интерфейса", "ru")).toBe("Язык интерфейса");
    expect(translate("Язык интерфейса", "en")).toBe("Interface language");
    expect(translate("Настройки", "en")).toBe("Settings");
    expect(translate("Твои проекты", "en")).toBe("Your projects");
  });

  it("translates dashboard states and mobile preview copy", () => {
    expect(translate("REMOTE", "ru")).toBe("УДАЛЁННЫЙ");
    expect(translate("Проекты не найдены.", "en")).toBe("No projects found.");
  });

  it("translates NEXUS Studio navigation and inbox controls", () => {
    expect(translate("NEXUS Studio", "ru")).toBe("Студия NEXUS");
    expect(translate("Universal Inbox", "ru")).toBe("Единый центр заметок");
    expect(translate("Search inbox", "ru")).toBe("Поиск по заметкам");
    expect(translate("Completed", "ru")).not.toBe("Completed");
    expect(translate("Knowledge Graph", "ru")).toBe("Граф знаний");
    expect(translate("NEXUS Studio", "en")).toBe("NEXUS Studio");
  });

  it("does not alter unknown technical identifiers", () => {
    expect(translate("gemini-3.1-flash-lite", "ru")).toBe("gemini-3.1-flash-lite");
  });
});
