/**
 * Per-paragraph language detection (brief §7).
 *
 * Deliberately small and dependency-free: script first, then a stopword vote
 * for Latin-script text. It exists to answer one question — *which checker,
 * if any, should see this paragraph* — and it reports how sure it is, because
 * the brief is explicit: "Never trust detection silently on a short
 * paragraph." A low-confidence answer means the caller falls back to the
 * language the writer declared, never to a guess.
 */
import { dominantScript } from "./script";

/** A BCP 47 language tag, or "und" when nothing can be said. */
export type LanguageTag = string;

export const UNKNOWN_LANGUAGE = "und";

export type Confidence = "high" | "low" | "none";

export interface Detection {
  language: LanguageTag;
  confidence: Confidence;
}

/**
 * Common short words, which are the cheapest reliable signal for
 * Latin-script languages. Kept small on purpose: this decides routing, not
 * linguistics.
 */
const STOPWORDS: Record<string, readonly string[]> = {
  en: "the and of to in that is it for was with as his on be at by this have from not are but had they you all were".split(
    " ",
  ),
  es: "el la de que y en los del se las por un para con no una su al lo como más pero sus le ya".split(
    " ",
  ),
  fr: "le la de et les des en un une du dans il que pour qui sur ne pas ce se plus par est au aux".split(
    " ",
  ),
  de: "der die und den von zu das mit sich des auf für ist nicht ein eine als auch es an werden aus er".split(
    " ",
  ),
  it: "il di che la per una non con del sono come anche più le dei nel alla si ma ha da gli".split(
    " ",
  ),
  pt: "de que não uma para com dos como mais por das ele seu sua ou quando muito nos já está também".split(
    " ",
  ),
  nl: "de van het een en in is dat op te zijn met voor niet aan er die maar om ook als dan".split(
    " ",
  ),
  pl: "nie się to jest na że do tym jak ale czy tak przez przy już który oraz lub bez pod".split(
    " ",
  ),
  sv: "och att det som en är för av på med till den har inte om men de ett var han".split(" "),
  tr: "bir ve bu için ile de da çok daha en gibi kadar ise ama sonra olarak her ne".split(" "),
};

/** Letters that only a few languages use, worth a nudge when stopwords tie. */
const HINTS: [RegExp, string][] = [
  [/[ñ¿¡]/u, "es"],
  [/[ãõç]/u, "pt"],
  [/[àâêîôûëïüÿœ]/u, "fr"],
  [/[äöüß]/u, "de"],
  [/[àèéìòù]/u, "it"],
  [/[ąćęłńóśźż]/u, "pl"],
  [/[åäö]/u, "sv"],
  [/[ğışçöü]/u, "tr"],
  [/[ij]{2}/u, "nl"],
];

const SHORT_TEXT_WORDS = 4;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s'’-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Detects the language of one paragraph. */
export function detectLanguage(text: string): Detection {
  const script = dominantScript(text);
  if (script === null) return { language: UNKNOWN_LANGUAGE, confidence: "none" };

  // Scripts that name their language on sight. Japanese wins over Han when
  // kana are present, because Japanese uses both.
  switch (script) {
    case "kana":
      return { language: "ja", confidence: "high" };
    case "han":
      return {
        language: /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? "ja" : "zh",
        confidence: "high",
      };
    case "hangul":
      return { language: "ko", confidence: "high" };
    case "thai":
      return { language: "th", confidence: "high" };
    case "hebrew":
      return { language: "he", confidence: "high" };
    case "greek":
      return { language: "el", confidence: "high" };
    case "arabic":
      return { language: /[پچژگی]/u.test(text) ? "fa" : "ar", confidence: "high" };
    case "devanagari":
      return { language: "hi", confidence: "high" };
    case "cyrillic":
      return { language: /[іїєґ]/u.test(text) ? "uk" : "ru", confidence: "high" };
    case "other":
      return { language: UNKNOWN_LANGUAGE, confidence: "none" };
    case "latin":
      break;
  }

  const tokens = words(text);
  if (tokens.length === 0) return { language: UNKNOWN_LANGUAGE, confidence: "none" };

  const scores = new Map<string, number>();
  for (const [language, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    let hits = 0;
    for (const token of tokens) if (set.has(token)) hits++;
    scores.set(language, hits / tokens.length);
  }
  for (const [pattern, language] of HINTS) {
    if (pattern.test(text)) scores.set(language, (scores.get(language) ?? 0) + 0.05);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0] ?? [UNKNOWN_LANGUAGE, 0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  // Not enough words to be sure, whatever the score says.
  if (tokens.length < SHORT_TEXT_WORDS) {
    return { language: bestScore > 0 ? best : "en", confidence: "low" };
  }
  if (bestScore === 0) return { language: "en", confidence: "low" };
  if (bestScore < 0.08 || bestScore - runnerUp < 0.02) return { language: best, confidence: "low" };
  return { language: best, confidence: "high" };
}

/** The language to use for a paragraph, given what the writer declared. */
export function languageFor(
  text: string,
  declared: LanguageTag | null,
  fallback: LanguageTag | null,
): LanguageTag {
  if (declared) return declared;
  const detected = detectLanguage(text);
  if (detected.confidence === "high") return detected.language;
  return fallback ?? (detected.confidence === "low" ? detected.language : UNKNOWN_LANGUAGE);
}

/** "en-GB" and "en" are the same language for routing purposes. */
export function sameLanguage(a: LanguageTag, b: LanguageTag): boolean {
  return baseLanguage(a) === baseLanguage(b);
}

export function baseLanguage(tag: LanguageTag): string {
  return tag.toLowerCase().split("-")[0] ?? tag;
}
