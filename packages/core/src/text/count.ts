/**
 * Language-aware counting (brief §7): whitespace splitting is wrong for
 * Chinese and Japanese, so those scripts are counted per character while
 * space-delimited scripts (and Thai, which the segmenter splits into words)
 * are counted per word. Both numbers are always available, plus a
 * non-whitespace character count.
 */
export interface TextCounts {
  /** Words in space-delimited scripts (Latin, Cyrillic, Arabic, Hangul…) and Thai. */
  words: number;
  /** Han and kana characters: the usual "word count" for Chinese and Japanese. */
  cjk: number;
  /** Visible characters (grapheme clusters, excluding whitespace). */
  characters: number;
}

export const ZERO_COUNTS: TextCounts = { words: 0, cjk: 0, characters: 0 };

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WHITESPACE = /^\s+$/u;

// Intl.Segmenter exists in every runtime Sheaf targets; the typings live in
// the ES2022 Intl lib, reached through globalThis like other runtime APIs here.
interface Segment {
  segment: string;
  isWordLike?: boolean;
}
interface Segmenter {
  segment(text: string): Iterable<Segment>;
}
type SegmenterCtor = new (
  locale: string | undefined,
  options: { granularity: "word" | "grapheme" },
) => Segmenter;
const IntlSegmenter = (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter;
const wordSegmenter = new IntlSegmenter(undefined, { granularity: "word" });
const graphemeSegmenter = new IntlSegmenter(undefined, { granularity: "grapheme" });

/** Hyphens that join a compound ("well-known" is one word, as in word processors). */
const JOINING_HYPHENS = new Set(["-", String.fromCharCode(0x2010), String.fromCharCode(0x2011)]);

export function countText(text: string): TextCounts {
  let words = 0;
  let cjk = 0;
  let previousWasWord = false;
  let joinNext = false;
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (!isWordLike) {
      joinNext = previousWasWord && JOINING_HYPHENS.has(segment);
      previousWasWord = false;
      continue;
    }
    const han = segment.match(CJK)?.length ?? 0;
    if (han > 0) {
      cjk += han;
      // A segment mixing CJK with Latin letters (rare) still counts its word part once.
      if (/[\p{L}\p{N}]/u.test(segment.replace(CJK, ""))) words++;
      previousWasWord = false;
    } else {
      if (!joinNext) words++;
      previousWasWord = true;
    }
    joinNext = false;
  }
  let characters = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (!WHITESPACE.test(segment)) characters++;
  }
  return { words, cjk, characters };
}

/** "Words" as most writers mean it: words plus CJK characters. */
export function wordTotal(counts: TextCounts): number {
  return counts.words + counts.cjk;
}

export function addCounts(a: TextCounts, b: TextCounts): TextCounts {
  return { words: a.words + b.words, cjk: a.cjk + b.cjk, characters: a.characters + b.characters };
}
