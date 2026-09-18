/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  localeDisplayName,
  pickLocale,
  resourcesFromModules,
  sortLocales,
  type TranslationTree,
} from "./locales";

const LOCALES_DIR = join(import.meta.dirname, "..", "locales");
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g;

function loadLocales(): Map<string, Map<string, TranslationTree>> {
  const out = new Map<string, Map<string, TranslationTree>>();
  for (const locale of readdirSync(LOCALES_DIR)) {
    const namespaces = new Map<string, TranslationTree>();
    for (const file of readdirSync(join(LOCALES_DIR, locale))) {
      if (!file.endsWith(".json")) continue;
      const text = readFileSync(join(LOCALES_DIR, locale, file), "utf8");
      namespaces.set(file.slice(0, -".json".length), JSON.parse(text) as TranslationTree);
    }
    out.set(locale, namespaces);
  }
  return out;
}

/** Flattens a tree to dotted keys → string values. */
function flatten(tree: TranslationTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? "").sort();
}

/** Groups plural variants (`x_one`, `x_other`) under their base key `x`. */
function byBaseKey(flat: Map<string, string>): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [key, value] of flat) {
    const suffix = PLURAL_SUFFIX.exec(key)?.[1] ?? "";
    const base = suffix ? key.slice(0, -(suffix.length + 1)) : key;
    const variants = out.get(base) ?? new Map<string, string>();
    variants.set(suffix, value);
    out.set(base, variants);
  }
  return out;
}

describe("pickLocale", () => {
  const available = ["en", "zh-Hans"];

  it.each([
    [["en-US"], "en"],
    [["en-GB"], "en"],
    [["zh-CN"], "zh-Hans"],
    [["zh-SG"], "zh-Hans"],
    [["zh"], "zh-Hans"],
    [["zh-Hans-CN"], "zh-Hans"],
    [["fr-FR", "zh-CN"], "zh-Hans"],
    [["fr-FR"], DEFAULT_LOCALE],
    [[], DEFAULT_LOCALE],
  ])("%j → %s", (preferred, expected) => {
    expect(pickLocale(preferred, available)).toBe(expected);
  });

  it("does not show Simplified Chinese to Traditional Chinese readers", () => {
    expect(pickLocale(["zh-TW"], available)).toBe("en");
    expect(pickLocale(["zh-HK"], available)).toBe("en");
    expect(pickLocale(["zh-Hant"], available)).toBe("en");
    expect(pickLocale(["zh-TW", "zh-CN"], available)).toBe("zh-Hans");
  });

  it("ignores malformed tags", () => {
    expect(pickLocale(["", "not a locale!!", "zh-CN"], available)).toBe("zh-Hans");
  });

  it("ignores malformed available locales without shifting the match", () => {
    expect(pickLocale(["zh-CN"], ["en", "bad tag!", "zh-Hans"])).toBe("zh-Hans");
    expect(pickLocale(["en-AU"], ["bad tag!", "en"])).toBe("en");
  });

  it("matches RTL locales by language and script", () => {
    expect(pickLocale(["ar-EG"], [...available, "ar"])).toBe("ar");
  });
});

describe("resourcesFromModules", () => {
  it("maps glob paths to locale → namespace", () => {
    const resources = resourcesFromModules({
      "../locales/en/common.json": { a: "A" },
      "../locales/zh-Hans/common.json": { a: "甲" },
      "../somewhere/else.json": { ignored: "yes" },
    });
    expect(resources).toEqual({ en: { common: { a: "A" } }, "zh-Hans": { common: { a: "甲" } } });
  });
});

describe("sortLocales / localeDisplayName", () => {
  it("puts the default locale first", () => {
    expect(sortLocales(["zh-Hans", "ar", "en"])).toEqual(["en", "ar", "zh-Hans"]);
  });

  it("names each locale in its own language", () => {
    expect(localeDisplayName("en")).toBe("English");
    expect(localeDisplayName("zh-Hans")).toBe("简体中文");
  });
});

describe("locale files", () => {
  const locales = loadLocales();
  const source = locales.get(DEFAULT_LOCALE);

  it("include the default locale and Simplified Chinese", () => {
    expect(source).toBeDefined();
    expect(locales.has("zh-Hans")).toBe(true);
  });

  it.each([...locales.keys()])("%s: folder name is a canonical BCP 47 tag", (locale) => {
    expect(Intl.getCanonicalLocales(locale)[0]).toBe(locale);
  });

  const others = [...locales.keys()].filter((l) => l !== DEFAULT_LOCALE);

  it.each(others)("%s: has exactly the namespaces and keys of the default locale", (locale) => {
    const target = locales.get(locale);
    expect([...(target?.keys() ?? [])].sort()).toEqual([...(source?.keys() ?? [])].sort());
    for (const [ns, tree] of source ?? []) {
      const want = [...byBaseKey(flatten(tree)).keys()].sort();
      const got = [...byBaseKey(flatten(target?.get(ns) ?? {})).keys()].sort();
      expect(got, `namespace "${ns}"`).toEqual(want);
    }
  });

  it.each(others)("%s: keeps every {{placeholder}} of the source string", (locale) => {
    for (const [ns, tree] of source ?? []) {
      const want = byBaseKey(flatten(tree));
      const got = byBaseKey(flatten(locales.get(locale)?.get(ns) ?? {}));
      for (const [key, variants] of want) {
        const expected = placeholders([...variants.values()][0] ?? "");
        for (const [suffix, text] of got.get(key) ?? []) {
          expect(placeholders(text), `${ns}:${key}${suffix ? `_${suffix}` : ""}`).toEqual(expected);
        }
      }
    }
  });

  it.each([...locales.keys()])("%s: plural keys cover the locale's plural categories", (locale) => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [ns, tree] of locales.get(locale) ?? []) {
      for (const [key, variants] of byBaseKey(flatten(tree))) {
        if (variants.has("")) continue; // Not a plural key.
        for (const category of categories) {
          expect(variants.has(category), `${ns}:${key}_${category}`).toBe(true);
        }
      }
    }
  });

  it.each([...locales.keys()])("%s: has no empty strings", (locale) => {
    for (const [ns, tree] of locales.get(locale) ?? []) {
      for (const [key, value] of flatten(tree)) {
        expect(value.trim(), `${ns}:${key}`).not.toBe("");
      }
    }
  });
});
