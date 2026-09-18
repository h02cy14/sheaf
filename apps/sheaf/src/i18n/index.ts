import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, pickLocale, resourcesFromModules, sortLocales } from "./locales";

const modules = import.meta.glob<unknown>("../locales/*/*.json", {
  eager: true,
  import: "default",
});

export const resources = resourcesFromModules(modules);
export const availableLocales: readonly string[] = sortLocales(Object.keys(resources));

const STORAGE_KEY = "sheaf.uiLocale";

// The UI locale is a per-device convenience, so localStorage is the right home
// for it. It can be unavailable (private mode, quota), so every access is guarded.
function readStoredLocale(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not persisting the choice is acceptable; the UI still switches.
  }
}

function applyDocumentLocale(locale: string): void {
  const root = document.documentElement;
  root.lang = locale;
  // Mirrors the whole UI for RTL locales. Layout uses logical CSS properties.
  root.dir = i18next.dir(locale);
}

export async function initI18n(): Promise<void> {
  const stored = readStoredLocale();
  const initial =
    stored !== undefined && availableLocales.includes(stored)
      ? stored
      : pickLocale(navigator.languages, availableLocales);

  await i18next.use(initReactI18next).init({
    resources,
    lng: initial,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...availableLocales],
    load: "currentOnly",
    ns: Object.keys(resources[DEFAULT_LOCALE] ?? {}),
    defaultNS: "common",
    interpolation: { escapeValue: false }, // React already escapes output.
  });

  applyDocumentLocale(initial);
  i18next.on("languageChanged", applyDocumentLocale);
}

export async function setUiLocale(locale: string): Promise<void> {
  await i18next.changeLanguage(locale);
  storeLocale(locale);
}
