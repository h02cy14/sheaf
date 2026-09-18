# i18n: UI localisation

**Why this exists:** the brief requires localisation from day one, with new
languages added as translation files rather than code. This module discovers
translation files automatically, picks the user's language, and keeps
`<html lang dir>` in sync so layout mirrors for RTL languages.

It covers the **app's interface language** only. The language *of the user's
writing* (word counting, spelling, grammar routing) is a separate concern and
lands in Phase 3.

## Adding a language

1. Create `src/locales/<tag>/common.json`, where `<tag>` is a canonical BCP 47
   tag: `ja`, `ko`, `ar`, `zh-Hant`, `pt-BR`.
2. Translate every key in `src/locales/en/common.json`. Keep `{{placeholders}}`
   exactly as they are.
3. Run `pnpm test`. It fails if a key, a placeholder, or a plural form the
   language needs (per `Intl.PluralRules`) is missing.

That's it. The language picker lists it automatically, under its own name
(`Intl.DisplayNames`), and RTL languages mirror the UI on their own.

## How the language is chosen

1. The user's explicit choice, stored per device.
2. Otherwise the first system language that matches an available locale on
   **language and script**. `zh-TW` (Traditional) does *not* fall back to
   `zh-Hans` (Simplified); it goes on to the next preference, or to English.
3. Otherwise English.

## Files

| File | Purpose |
|---|---|
| `locales.ts` | Pure helpers: discovery, matching, display names. Unit-tested in Node |
| `index.ts` | i18next setup, persistence, `lang`/`dir` sync |
| `i18next.d.ts` | Makes `t("key")` type-checked against the English file |
| `locales.test.ts` | Locale matching tests plus translation-completeness checks |
