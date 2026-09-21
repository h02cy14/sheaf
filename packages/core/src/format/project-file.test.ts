import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseProjectFile, serializeProjectFile } from "./project-file";
import type { RootId } from "./types";

const ROOTS: Record<RootId, string> = {
  manuscript: "Manuscript",
  research: "Research",
  trash: "Trash",
};

function parse(settings: unknown) {
  const text = JSON.stringify({
    format: "sheaf-project",
    formatVersion: 1,
    id: "01J9ZK3D7Q0W6Y8V4T2R5N1M0P",
    title: "Novel",
    created: "2026-09-21T09:00:00.000Z",
    roots: ROOTS,
    settings,
  });
  const parsed = parseProjectFile(text, ROOTS);
  if (!parsed.ok) throw new Error(`expected a project, got ${parsed.error}`);
  return parsed.project.settings;
}

describe("project settings", () => {
  it("defaults to checking on, no language declared, and nothing configured", () => {
    expect(parse({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.checkGrammar).toBe(true);
    expect(DEFAULT_SETTINGS.languageToolEndpoint).toBeNull();
  });

  it("keeps a LanguageTool endpoint only when it is a plain http address", () => {
    expect(
      parse({ languageToolEndpoint: "http://localhost:8081/v2/check" }).languageToolEndpoint,
    ).toBe("http://localhost:8081/v2/check");
    // https would mean a server somewhere else, so it is refused everywhere
    // in Sheaf — here, in the dialog, and in the shell that makes the call.
    for (const endpoint of [
      "https://api.languagetool.org/v2/check",
      "ftp://example.com",
      "localhost:8081",
      "",
      42,
    ]) {
      expect(
        parse({ languageToolEndpoint: endpoint }).languageToolEndpoint,
        String(endpoint),
      ).toBeNull();
    }
  });

  it("reads the language, dialect and the writer's own words back", () => {
    const settings = parse({
      language: " zh ",
      dialect: "british",
      checkGrammar: false,
      dictionary: ["mirelight", "mirelight", "Thessaly", "  "],
      ignored: ["repetition|the the"],
    });
    expect(settings).toMatchObject({
      language: "zh",
      dialect: "british",
      checkGrammar: false,
      dictionary: ["mirelight", "Thessaly"],
      ignored: ["repetition|the the"],
    });
  });

  it("ignores a dialect it doesn't know", () => {
    expect(parse({ dialect: "martian" }).dialect).toBe("american");
  });

  it("survives a round trip through the file", () => {
    const settings = parse({
      language: "en",
      dialect: "australian",
      dictionary: ["mirelight"],
      ignored: ["typo|mirelight"],
      languageToolEndpoint: "http://127.0.0.1:8081/v2/check",
      manuscriptTarget: 90000,
    });
    const project = {
      formatVersion: 1,
      id: "01J9ZK3D7Q0W6Y8V4T2R5N1M0P",
      title: "Novel",
      created: "2026-09-21T09:00:00.000Z",
      roots: ROOTS,
      settings,
      extra: {},
    };
    const again = parseProjectFile(serializeProjectFile(project), ROOTS);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.project.settings).toEqual(settings);
  });
});
