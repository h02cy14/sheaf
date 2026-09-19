import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { availableLocales, setUiLocale } from "../i18n";
import { localeDisplayName } from "../i18n/locales";
import { displayName } from "../platform";
import { useAppStore } from "../state/app-store";
import styles from "./Home.module.css";

function relativeTime(ms: number, locale: string): string {
  if (!ms) return "";
  const minutes = Math.round((ms - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
}

/**
 * Landing screen when no project is open. One obvious action, New project,
 * gets a new writer typing in seconds (brief §6).
 */
export function Home() {
  const { t, i18n } = useTranslation();
  const projects = useAppStore((s) => s.projects);
  const error = useAppStore((s) => s.error);
  const storage = useAppStore((s) => s.storage);
  const busy = useAppStore((s) => s.screen === "opening");
  const createProject = useAppStore((s) => s.createProject);
  const openProject = useAppStore((s) => s.openProject);
  const pickAndOpenProject = useAppStore((s) => s.pickAndOpenProject);
  const languageId = useId();

  return (
    <main className={styles.home}>
      <header className={styles.brand}>
        <img className={styles.logo} src="/icon.svg" alt="" width={64} height={64} />
        <div>
          <h1 className={styles.name}>Sheaf</h1>
          <p className={styles.tagline}>{t("app.tagline")}</p>
        </div>
      </header>

      <section className={styles.start} aria-labelledby="start-heading">
        <h2 id="start-heading" className={styles.visuallyHidden}>
          {t("home.startHeading")}
        </h2>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void createProject()}
          disabled={busy}
        >
          <Icon name="plusDocument" size={20} />
          {t("home.newProject")}
        </button>
        <p className={styles.hint}>{t("home.newProjectHint")}</p>
        {storage?.canPickFolders && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void pickAndOpenProject()}
            disabled={busy}
          >
            {t("home.openFolder")}
          </button>
        )}
      </section>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <section className={styles.projects} aria-labelledby="projects-heading">
        <h2 id="projects-heading" className={styles.sectionHeading}>
          {t("home.yourProjects")}
        </h2>
        {projects.length === 0 ? (
          <p className={styles.muted}>{t("home.noProjects")}</p>
        ) : (
          <ul className={styles.list}>
            {projects.map((p) => (
              <li key={p.root}>
                <button
                  type="button"
                  className={styles.project}
                  onClick={() => void openProject(p.root)}
                  disabled={busy}
                >
                  <Icon name="manuscript" />
                  <span className={styles.projectName}>
                    {p.name ? displayName(p.name) : displayName(p.root)}
                  </span>
                  <span className={styles.muted}>{relativeTime(p.modifiedMs, i18n.language)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {storage?.kind === "browser" && <p className={styles.muted}>{t("home.browserNotice")}</p>}
      </section>

      <footer className={styles.footer}>
        <label className={styles.language}>
          <span id={languageId}>{t("home.language")}</span>
          <select
            aria-labelledby={languageId}
            value={i18n.resolvedLanguage}
            onChange={(e) => void setUiLocale(e.target.value)}
          >
            {availableLocales.map((locale) => (
              <option key={locale} value={locale} lang={locale}>
                {localeDisplayName(locale)}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.muted}>{t("principles")}</p>
      </footer>
    </main>
  );
}
