/**
 * Which writing system a piece of text is in. Script is the first and most
 * reliable signal for language routing (brief §7): Han characters mean
 * Chinese or Japanese and therefore no grammar checking, Latin means the
 * question is still open.
 */

export type ScriptName =
  | "latin"
  | "han"
  | "kana"
  | "hangul"
  | "cyrillic"
  | "greek"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "thai"
  | "other";

const PATTERNS: [ScriptName, RegExp][] = [
  ["latin", /\p{Script=Latin}/u],
  ["han", /\p{Script=Han}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["thai", /\p{Script=Thai}/u],
];

/** Scripts that read right to left, so the UI can mirror (brief §7). */
const RTL_SCRIPTS = new Set<ScriptName>(["arabic", "hebrew"]);

export type ScriptCounts = Record<ScriptName, number>;

export function countScripts(text: string): ScriptCounts {
  const counts = {
    latin: 0,
    han: 0,
    kana: 0,
    hangul: 0,
    cyrillic: 0,
    greek: 0,
    arabic: 0,
    hebrew: 0,
    devanagari: 0,
    thai: 0,
    other: 0,
  };
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue; // punctuation, digits and spaces say nothing
    let matched = false;
    for (const [name, pattern] of PATTERNS) {
      if (pattern.test(ch)) {
        counts[name]++;
        matched = true;
        break;
      }
    }
    if (!matched) counts.other++;
  }
  return counts;
}

/** The script most of the letters are in, or null when there are no letters. */
export function dominantScript(text: string): ScriptName | null {
  const counts = countScripts(text);
  let best: ScriptName | null = null;
  let most = 0;
  for (const [name, n] of Object.entries(counts) as [ScriptName, number][]) {
    if (n > most) {
      best = name;
      most = n;
    }
  }
  return best;
}

/** True when the text should be laid out right to left. */
export function isRtlText(text: string): boolean {
  const counts = countScripts(text);
  const rtl = [...RTL_SCRIPTS].reduce((n, script) => n + counts[script], 0);
  const ltr = counts.latin + counts.han + counts.kana + counts.hangul + counts.cyrillic;
  return rtl > ltr;
}

/** True for languages written right to left, by language tag. */
export function isRtlLanguage(language: string): boolean {
  const base = language.toLowerCase().split("-")[0] ?? "";
  return ["ar", "he", "fa", "ur", "ps", "sd", "yi", "dv"].includes(base);
}
