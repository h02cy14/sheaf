import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./App.module.css";
import { availableLocales, setUiLocale } from "./i18n";
import { localeDisplayName } from "./i18n/locales";
import { detectRuntime, osDisplayName, type Runtime } from "./platform";

type RuntimeState =
  | { status: "detecting" }
  | { status: "ready"; runtime: Runtime }
  | { status: "error"; message: string };

/**
 * Phase 0 placeholder screen. Proves, on every target, that the shell starts,
 * the Rust bridge answers, i18n and RTL switching work, and the software
 * keyboard/IME can type into a field without covering it.
 */
export function App() {
  const { t, i18n } = useTranslation();
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "detecting" });
  const languageId = useId();
  const scratchId = useId();
  const hintId = useId();

  useEffect(() => {
    let cancelled = false;
    detectRuntime().then(
      (value) => {
        if (!cancelled) setRuntime({ status: "ready", runtime: value });
      },
      (error: unknown) => {
        if (!cancelled) setRuntime({ status: "error", message: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  let runtimeLine: string;
  switch (runtime.status) {
    case "detecting":
      runtimeLine = t("phase0.runtime.detecting");
      break;
    case "error":
      runtimeLine = t("phase0.runtime.error", { message: runtime.message });
      break;
    case "ready":
      runtimeLine =
        runtime.runtime.kind === "native"
          ? t("phase0.runtime.native", {
              os: osDisplayName(runtime.runtime.info.os),
              arch: runtime.runtime.info.arch,
              version: runtime.runtime.info.version,
            })
          : t("phase0.runtime.browser");
      break;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <img className={styles.logo} src="/icon.svg" alt="" width={56} height={56} />
        <div>
          <h1 className={styles.title}>Sheaf</h1>
          <p className={styles.tagline}>{t("app.tagline")}</p>
        </div>
      </header>

      <p className={styles.notice} role="note">
        {t("phase0.notice")}
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={languageId}>
          {t("phase0.language")}
        </label>
        <select
          id={languageId}
          className={styles.select}
          value={i18n.resolvedLanguage}
          onChange={(event) => void setUiLocale(event.target.value)}
        >
          {availableLocales.map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {localeDisplayName(locale)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={scratchId}>
          {t("phase0.scratch.label")}
        </label>
        <p className={styles.hint} id={hintId}>
          {t("phase0.scratch.hint")}
        </p>
        <textarea
          id={scratchId}
          className={styles.scratch}
          aria-describedby={hintId}
          dir="auto"
          rows={6}
          placeholder={t("phase0.scratch.placeholder")}
        />
      </div>

      <footer className={styles.footer}>
        <p aria-live="polite">{runtimeLine}</p>
        <p>{t("principles")}</p>
      </footer>
    </main>
  );
}
