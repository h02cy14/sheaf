import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { currentSession, useAppStore } from "../state/app-store";
import { useCounts } from "../status/useCounts";
import styles from "./Inspector.module.css";

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Per-document metadata: title, synopsis, type, dates, count and target. */
export function Inspector({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const { t, i18n } = useTranslation();
  const activeDocId = useAppStore((s) =>
    s.activePane === "secondary" ? s.secondDocId : s.activeDocId,
  );
  const meta = useAppStore((s) =>
    activeDocId ? s.snapshot?.docs.get(activeDocId)?.meta : undefined,
  );
  const counts = useCounts();
  const titleId = useId();
  const synopsisId = useId();
  const targetId = useId();
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

      <label className={styles.label} htmlFor={targetId}>
        {t("inspector.target")}
      </label>
      <input
        key={`${activeDocId}:target`}
        id={targetId}
        className={styles.input}
        type="number"
        min={0}
        step={50}
        inputMode="numeric"
        defaultValue={meta.target ?? ""}
        placeholder={t("targets.noTarget")}
        onBlur={(e) => {
          const raw = e.currentTarget.value.trim();
          const value = raw === "" ? null : Math.max(0, Math.round(Number(raw)));
          const target = value === null || value === 0 || !Number.isFinite(value) ? null : value;
          if (target !== meta.target) void currentSession().setTarget(activeDocId, target);
        }}
      />

      <dl className={styles.facts}>
        <dt>{t("inspector.kind")}</dt>
        <dd>{t(meta.kind === "folder" ? "inspector.kinds.folder" : "inspector.kinds.text")}</dd>
        {counts && (
          <>
            <dt>{t("counts.document")}</dt>
            <dd>
              {t(counts.unit === "characters" ? "counts.characters" : "counts.words", {
                count: counts.doc,
                formatted: new Intl.NumberFormat(i18n.language).format(counts.doc),
              })}
            </dd>
          </>
        )}
        <dt>{t("inspector.created")}</dt>
        <dd>{formatDate(meta.created, i18n.language)}</dd>
        <dt>{t("inspector.modified")}</dt>
        <dd>{formatDate(meta.modified, i18n.language)}</dd>
      </dl>

      {onOpenHistory && (
        <button type="button" className={styles.historyButton} onClick={onOpenHistory}>
          <Icon name="history" size={15} />
          <span>{t("history.open")}</span>
        </button>
      )}
    </div>
  );
}
