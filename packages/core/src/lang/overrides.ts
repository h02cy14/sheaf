/**
 * Paragraph-level language overrides (brief §7: "a manual override at
 * document level and at paragraph level").
 *
 * A paragraph has no identity in Markdown — no id, no attribute we could
 * write without spoiling the file — so an override is anchored to the
 * paragraph's opening words instead. Edit that opening and the override
 * lets go, which is the right behaviour: it was attached to that sentence,
 * not to that position in the file.
 *
 * They live in the document's frontmatter under `paragraphLanguages`, which
 * the format layer already preserves as an unknown key, so an older build of
 * Sheaf carries them along untouched.
 */

/** How much of a paragraph identifies it. Long enough to be unique in a
 * chapter, short enough to survive editing further down the paragraph. */
const ANCHOR_LENGTH = 48;

export type ParagraphLanguages = Record<string, string>;

const KEY = "paragraphLanguages";

/** The opening words of a paragraph, normalised so spacing doesn't matter. */
export function paragraphAnchor(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, ANCHOR_LENGTH);
}

export function readParagraphLanguages(extra: Record<string, unknown>): ParagraphLanguages {
  const raw = extra[KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: ParagraphLanguages = {};
  for (const [anchor, language] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof language === "string" && language.trim() !== "" && anchor.trim() !== "") {
      out[anchor] = language.trim();
    }
  }
  return out;
}

/** The language the writer chose for this paragraph, if they chose one. */
export function paragraphLanguage(overrides: ParagraphLanguages, text: string): string | null {
  return overrides[paragraphAnchor(text)] ?? null;
}

/**
 * Sets or clears one paragraph's language, returning new frontmatter extras.
 * `keep` is every paragraph currently in the document: overrides that match
 * none of them are dropped, so the list cannot grow forever.
 */
export function withParagraphLanguage(
  extra: Record<string, unknown>,
  text: string,
  language: string | null,
  keep?: readonly string[],
): Record<string, unknown> {
  const anchor = paragraphAnchor(text);
  const current = readParagraphLanguages(extra);
  const next: ParagraphLanguages = {};
  const alive = keep ? new Set(keep.map(paragraphAnchor)) : null;
  for (const [key, value] of Object.entries(current)) {
    if (key === anchor) continue;
    if (alive && !alive.has(key)) continue;
    next[key] = value;
  }
  if (language !== null) next[anchor] = language;

  // Rebuilt rather than deleted from, so the key disappears cleanly when the
  // last override goes.
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (key !== KEY) result[key] = value;
  }
  if (Object.keys(next).length > 0) result[KEY] = next;
  return result;
}
