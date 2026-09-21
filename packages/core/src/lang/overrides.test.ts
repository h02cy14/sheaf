import { describe, expect, it } from "vitest";
import {
  paragraphAnchor,
  paragraphLanguage,
  readParagraphLanguages,
  withParagraphLanguage,
} from "./overrides";

const ITALIAN = "Il guardiano ha contato le onde per tutta la notte.";
const ENGLISH = "The keeper counted the waves until morning came.";

describe("paragraph language overrides", () => {
  it("anchors to the opening words, ignoring how they are spaced", () => {
    expect(paragraphAnchor("  The keeper   counted\nthe waves.  ")).toBe(
      "The keeper counted the waves.",
    );
    expect(paragraphAnchor("x".repeat(100)).length).toBe(48);
  });

  it("remembers a language for one paragraph and leaves the others alone", () => {
    const extra = withParagraphLanguage({}, ITALIAN, "it");
    const overrides = readParagraphLanguages(extra);
    expect(paragraphLanguage(overrides, ITALIAN)).toBe("it");
    expect(paragraphLanguage(overrides, ENGLISH)).toBeNull();
  });

  it("keeps the rest of the frontmatter untouched", () => {
    const extra = withParagraphLanguage({ mood: "storm" }, ITALIAN, "it");
    expect(extra["mood"]).toBe("storm");
  });

  it("lets go when the opening words are rewritten", () => {
    const extra = withParagraphLanguage({}, ITALIAN, "it");
    const rewritten = "Quella notte il guardiano ha contato le onde.";
    expect(paragraphLanguage(readParagraphLanguages(extra), rewritten)).toBeNull();
  });

  it("clears an override, and drops the key when nothing is left", () => {
    let extra = withParagraphLanguage({}, ITALIAN, "it");
    extra = withParagraphLanguage(extra, ITALIAN, null);
    expect(readParagraphLanguages(extra)).toEqual({});
    expect(Object.keys(extra)).toEqual([]);
  });

  it("forgets overrides for paragraphs that are no longer in the document", () => {
    let extra = withParagraphLanguage({}, ITALIAN, "it");
    extra = withParagraphLanguage(extra, ENGLISH, "en", [ITALIAN, ENGLISH]);
    expect(Object.keys(readParagraphLanguages(extra))).toHaveLength(2);

    // The Italian paragraph has been deleted; only the English one is kept.
    extra = withParagraphLanguage(extra, ENGLISH, "en", [ENGLISH]);
    const left = readParagraphLanguages(extra);
    expect(paragraphLanguage(left, ENGLISH)).toBe("en");
    expect(paragraphLanguage(left, ITALIAN)).toBeNull();
  });

  it("ignores frontmatter that isn't a map of languages", () => {
    expect(readParagraphLanguages({ paragraphLanguages: "nonsense" })).toEqual({});
    expect(readParagraphLanguages({ paragraphLanguages: ["it"] })).toEqual({});
    expect(readParagraphLanguages({ paragraphLanguages: { "  ": "it", ok: 42 } })).toEqual({});
  });
});
