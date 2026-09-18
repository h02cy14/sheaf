/**
 * Locale discovery and matching.
 *
 * Pure functions only (no DOM, no i18next) so they can be unit-tested in Node.
 * Adding a UI language is a translation-file change, never a code change: drop
 * `src/locales/<bcp47-tag>/<namespace>.json` in place and it is discovered.
 */

export const DEFAULT_LOCALE = "en";

/** Translation tree for one namespace, e.g. the contents of `common.json`. */
export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

/** i18next resources: locale → namespace → translation tree. */
export type Resources = Record<string, Record<string, TranslationTree>>;

const LOCALE_PATH = /\/locales\/([^/]+)\/([^/]+)\.json$/;

/**
 * Builds i18next resources from the result of
 * `import.meta.glob("../locales/<locale>/<namespace>.json", { eager: true, import: "default" })`.
 */
export function resourcesFromModules(modules: Readonly<Record<string, unknown>>): Resources {
  const resources: Resources = {};
  for (const [path, tree] of Object.entries(modules)) {
    const match = LOCALE_PATH.exec(path);
    if (!match) continue;
    const [, locale, namespace] = match as unknown as [string, string, string];
    resources[locale] ??= {};
    resources[locale][namespace] = tree as TranslationTree;
  }
  return resources;
}

/** Sorts locales for display: the default first, the rest alphabetically. */
export function sortLocales(locales: Iterable<string>): string[] {
  return [...locales].sort((a, b) => {
    if (a === DEFAULT_LOCALE) return -1;
    if (b === DEFAULT_LOCALE) return 1;
    return a.localeCompare(b);
  });
}

interface LocaleParts {
  /** The tag exactly as given. */
  tag: string;
  language: string;
  script: string | undefined;
}

function parts(tag: string): LocaleParts | undefined {
  try {
    const max = new Intl.Locale(tag).maximize();
    return { tag, language: max.language, script: max.script };
  } catch {
    return undefined; // Not a valid BCP 47 tag; ignore it.
  }
}

/**
 * Picks the best available UI locale for the user's preference list.
 *
 * Language and script must both match: `zh-TW` maximises to `zh-Hant-TW` and
 * therefore does NOT fall back to `zh-Hans`. Silently showing Simplified
 * Chinese to someone who reads Traditional is a bad default. They get the
 * next preference, or English, and can switch explicitly.
 */
export function pickLocale(
  preferred: readonly string[],
  available: readonly string[],
  fallback: string = DEFAULT_LOCALE,
): string {
  const candidates = available.map(parts).filter((p): p is LocaleParts => p !== undefined);

  for (const wanted of preferred) {
    const w = parts(wanted);
    if (!w) continue;
    const exact = candidates.find((c) => c.tag.toLowerCase() === w.tag.toLowerCase());
    if (exact) return exact.tag;
    const sameScript = candidates.find((c) => c.language === w.language && c.script === w.script);
    if (sameScript) return sameScript.tag;
  }
  return fallback;
}

/** A locale's name written in that locale, e.g. "简体中文" for zh-Hans. */
export function localeDisplayName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
