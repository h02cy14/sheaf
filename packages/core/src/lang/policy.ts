/**
 * Which checker, if any, is allowed to see a paragraph (brief §7).
 *
 * Two rules here are not preferences and must not become options:
 *
 * 1. **Chinese is never checked.** No engine exists that is worth the false
 *    positives, so Sheaf says so plainly and quietly instead of pretending.
 *    The same calm treatment covers every other language we have no engine
 *    for — the writer is told once, in the status bar, and never nagged.
 * 2. **LanguageTool is never contacted unless the writer configured an
 *    endpoint themselves.** The default is local-only or nothing.
 */
import { baseLanguage, UNKNOWN_LANGUAGE, type LanguageTag } from "./detect";

export type CheckerEngine = "harper" | "languagetool" | "none";

export type SuppressionReason =
  /** Deliberate: Chinese gets no grammar or spell checking, by design. */
  | "chinese"
  /** Nothing offline, and no endpoint the writer configured. */
  | "no-engine"
  /** Too little text, or a script we can't name. */
  | "unknown-language"
  /** The writer turned checking off for this project. */
  | "turned-off";

export interface CheckerChoice {
  engine: CheckerEngine;
  language: LanguageTag;
  reason?: SuppressionReason;
}

export interface CheckerSettings {
  /** Master switch for the project. */
  checkGrammar: boolean;
  /** A LanguageTool server the writer configured and confirmed; null by default. */
  languageToolEndpoint: string | null;
}

export interface CheckerAvailability {
  /** Harper, bundled and offline. False in the browser preview. */
  harper: boolean;
}

/** Languages that get nothing, deliberately (brief §7). */
const NEVER_CHECKED = new Set(["zh", "yue", "wuu", "nan", "hak"]);

/** Harper is English-only. */
const HARPER_LANGUAGES = new Set(["en"]);

/** What a LanguageTool server can actually check. Chinese is not on it. */
const LANGUAGETOOL_LANGUAGES = new Set([
  "ar",
  "ast",
  "be",
  "br",
  "ca",
  "da",
  "de",
  "el",
  "en",
  "eo",
  "es",
  "fa",
  "fr",
  "ga",
  "gl",
  "it",
  "ja",
  "km",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "ta",
  "tl",
  "uk",
]);

export function chooseChecker(
  language: LanguageTag,
  settings: CheckerSettings,
  available: CheckerAvailability,
): CheckerChoice {
  const base = baseLanguage(language);

  // Deliberate suppression comes before everything, including the master
  // switch, so the indicator says *why* rather than just "off".
  if (NEVER_CHECKED.has(base)) return { engine: "none", language, reason: "chinese" };
  if (language === UNKNOWN_LANGUAGE || base === "") {
    return { engine: "none", language, reason: "unknown-language" };
  }
  if (!settings.checkGrammar) return { engine: "none", language, reason: "turned-off" };

  if (available.harper && HARPER_LANGUAGES.has(base)) {
    return { engine: "harper", language };
  }
  if (settings.languageToolEndpoint !== null && LANGUAGETOOL_LANGUAGES.has(base)) {
    return { engine: "languagetool", language };
  }
  return { engine: "none", language, reason: "no-engine" };
}

/** True if a LanguageTool endpoint would be contacted for this language. */
export function wouldLeaveDevice(
  language: LanguageTag,
  settings: CheckerSettings,
  available: CheckerAvailability,
): boolean {
  return chooseChecker(language, settings, available).engine === "languagetool";
}
