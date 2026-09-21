/**
 * Language and checking, in one place (brief §7).
 *
 * The page is written to be read: it says what Sheaf checks, what it
 * deliberately doesn't, and — for the one setting that can send text off the
 * device — exactly what filling it in means.
 */
import type { ProjectSettings } from "@sheaf/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { currentSession, useAppStore } from "../state/app-store";
import styles from "./LanguageDialog.module.css";

/** Languages offered in the pickers. Detection handles everything else. */
const LANGUAGES = [
  "en",
  "zh",
  "ja",
  "ko",
  "ar",
  "he",
  "fa",
  "ru",
  "uk",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "pl",
  "sv",
  "da",
  "tr",
  "th",
  "hi",
  "id",
  "vi",
] as const;

/** The opening of a paragraph, for showing which one an override applies to. */
function opening(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

/** A language's name in the reader's own language, e.g. "中文" in a zh UI. */
export function languageName(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function LanguageDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = useAppStore((s) => s.snapshot?.project.settings);
  const activeDocId = useAppStore((s) =>
    s.activePane === "secondary" ? s.secondDocId : s.activeDocId,
  );
  const doc = useAppStore((s) => (activeDocId ? s.snapshot?.docs.get(activeDocId) : undefined));
  const paragraph = useAppStore((s) => s.languageStatus[s.activePane]);
  const [error, setError] = useState<string | null>(null);
  const ids = {
    project: useId(),
    document: useId(),
    paragraph: useId(),
    dialect: useId(),
    check: useId(),
    endpoint: useId(),
  };

  if (!settings) return null;

  const save = (patch: Partial<ProjectSettings>): void => {
    setError(null);
    void currentSession()
      .updateSettings(patch)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const options = LANGUAGES.map((tag) => ({ tag, name: languageName(tag, i18n.language) })).sort(
    (a, b) => a.name.localeCompare(b.name, i18n.language),
  );

  return (
    <Dialog title={t("language.title")} onClose={onClose}>
      <div className={styles.grid}>
        <label htmlFor={ids.project}>{t("language.projectLanguage")}</label>
        <select
          id={ids.project}
          className={styles.input}
          value={settings.language ?? ""}
          onChange={(e) => save({ language: e.currentTarget.value || null })}
        >
          <option value="">{t("language.detect")}</option>
          {options.map((option) => (
            <option key={option.tag} value={option.tag}>
              {option.name}
            </option>
          ))}
        </select>
        <p className={styles.hint}>{t("language.projectLanguageHint")}</p>

        {activeDocId && doc && (
          <>
            <label htmlFor={ids.document}>
              {t("language.documentLanguage", { title: doc.meta.title })}
            </label>
            <select
              id={ids.document}
              className={styles.input}
              value={doc.meta.language ?? ""}
              onChange={(e) => {
                void currentSession()
                  .setLanguage(activeDocId, e.currentTarget.value || null)
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
              }}
            >
              <option value="">{t("language.followProject")}</option>
              {options.map((option) => (
                <option key={option.tag} value={option.tag}>
                  {option.name}
                </option>
              ))}
            </select>
            <p className={styles.hint}>{t("language.documentLanguageHint")}</p>
          </>
        )}

        {activeDocId && paragraph && paragraph.text !== "" && (
          <>
            <label htmlFor={ids.paragraph}>{t("language.thisParagraph")}</label>
            <select
              id={ids.paragraph}
              className={styles.input}
              value={paragraph.overridden ? paragraph.language : ""}
              onChange={(e) => {
                void currentSession()
                  .setParagraphLanguage(activeDocId, paragraph.text, e.currentTarget.value || null)
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
              }}
            >
              <option value="">{t("language.detect")}</option>
              {options.map((option) => (
                <option key={option.tag} value={option.tag}>
                  {option.name}
                </option>
              ))}
            </select>
            <p className={styles.hint}>
              {t("language.thisParagraphHint", { opening: opening(paragraph.text) })}
            </p>
          </>
        )}

        <label htmlFor={ids.check}>{t("language.checking")}</label>
        <div className={styles.switchRow}>
          <input
            id={ids.check}
            type="checkbox"
            checked={settings.checkGrammar}
            onChange={(e) => save({ checkGrammar: e.currentTarget.checked })}
          />
          <label htmlFor={ids.check}>{t("language.checkingOn")}</label>
        </div>
        <p className={styles.hint}>{t("language.checkingHint")}</p>

        <label htmlFor={ids.dialect}>{t("language.dialect")}</label>
        <select
          id={ids.dialect}
          className={styles.input}
          value={settings.dialect}
          onChange={(e) => save({ dialect: e.currentTarget.value as ProjectSettings["dialect"] })}
        >
          <option value="american">{t("language.dialects.american")}</option>
          <option value="british">{t("language.dialects.british")}</option>
          <option value="canadian">{t("language.dialects.canadian")}</option>
          <option value="australian">{t("language.dialects.australian")}</option>
        </select>
        <p className={styles.hint}>{t("language.dialectHint")}</p>

        <label htmlFor={ids.endpoint}>{t("language.languageTool")}</label>
        <input
          id={ids.endpoint}
          className={styles.input}
          type="url"
          inputMode="url"
          placeholder="http://localhost:8081/v2/check"
          defaultValue={settings.languageToolEndpoint ?? ""}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value !== "" && !value.startsWith("http://")) {
              setError(t("language.endpointMustBeHttp"));
              e.currentTarget.value = settings.languageToolEndpoint ?? "";
              return;
            }
            save({ languageToolEndpoint: value === "" ? null : value });
          }}
        />
        <p className={styles.hint}>{t("language.languageToolHint")}</p>
        {settings.languageToolEndpoint !== null && (
          <p className={styles.warning} role="note">
            <Icon name="warning" size={15} />
            <span>
              {t("language.languageToolActive", { endpoint: settings.languageToolEndpoint })}
            </span>
          </p>
        )}
      </div>

      <section className={styles.section}>
        <h3 className={styles.heading}>{t("language.dictionary")}</h3>
        {settings.dictionary.length === 0 ? (
          <p className={styles.hint}>{t("language.dictionaryEmpty")}</p>
        ) : (
          <ul className={styles.words}>
            {settings.dictionary.map((word) => (
              <li key={word}>
                <span>{word}</span>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={t("language.removeWord", { word })}
                  onClick={() => void currentSession().removeFromDictionary(word)}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {settings.ignored.length > 0 && (
          <p className={styles.hint}>
            {t("language.ignoredCount", { count: settings.ignored.length })}{" "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => void currentSession().clearIgnored()}
            >
              {t("language.clearIgnored")}
            </button>
          </p>
        )}
      </section>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
