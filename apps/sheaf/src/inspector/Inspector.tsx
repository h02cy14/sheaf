import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { currentSession, useAppStore } from "../state/app-store";
import styles from "./Inspector.module.css";

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Per-document metadata. Phase 1: title, synopsis, type, dates. */
export function Inspector() {
  const { t, i18n } = useTranslation();
  const activeDocId = useAppStore((s) => s.activeDocId);
  const meta = useAppStore((s) =>
    s.activeDocId ? s.snapshot?.docs.get(s.activeDocId)?.meta : undefined,
  );
  const titleId = useId();
  const synopsisId = useId();
  const pending = useRef<{ id: string; text: string; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );

  // Synopsis saves shortly after typing pauses, and when leaving the field.
  function flushSynopsis(): void {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    void currentSession().setSynopsis(p.id, p.text);
  }
  useEffect(() => flushSynopsis, [activeDocId]);

  if (!activeDocId || !meta) {
    return (
      <div className={styles.inspector}>
        <h2 className={styles.heading}>{t("inspector.label")}</h2>
        <p className={styles.empty}>{t("inspector.none")}</p>
      </div>
    );
  }

  return (
    <div className={styles.inspector}>
      <h2 className={styles.heading}>{t("inspector.label")}</h2>

      <label className={styles.label} htmlFor={titleId}>
        {t("inspector.title")}
      </label>
      <input
        key={`${activeDocId}:${meta.title}`}
        id={titleId}
        className={styles.input}
        defaultValue={meta.title}
        onBlur={(e) => {
          const title = e.currentTarget.value.trim() || t("session.untitled");
          if (title !== meta.title) void currentSession().rename(activeDocId, title);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
        }}
      />

      <label className={styles.label} htmlFor={synopsisId}>
        {t("inspector.synopsis")}
      </label>
      <textarea
        key={activeDocId}
        id={synopsisId}
        className={styles.textarea}
        defaultValue={meta.synopsis}
        placeholder={t("inspector.synopsisPlaceholder")}
        rows={6}
        dir="auto"
        onChange={(e) => {
          const text = e.currentTarget.value;
          if (pending.current) clearTimeout(pending.current.timer);
          pending.current = { id: activeDocId, text, timer: setTimeout(flushSynopsis, 700) };
        }}
        onBlur={flushSynopsis}
      />

      <dl className={styles.facts}>
        <dt>{t("inspector.kind")}</dt>
        <dd>{t(meta.kind === "folder" ? "inspector.kinds.folder" : "inspector.kinds.text")}</dd>
        <dt>{t("inspector.created")}</dt>
        <dd>{formatDate(meta.created, i18n.language)}</dd>
        <dt>{t("inspector.modified")}</dt>
        <dd>{formatDate(meta.modified, i18n.language)}</dd>
      </dl>
    </div>
  );
}
