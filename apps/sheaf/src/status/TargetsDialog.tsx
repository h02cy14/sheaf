import type { ProjectSettings } from "@sheaf/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../components/Dialog";
import { currentSession, useAppStore } from "../state/app-store";
import styles from "./TargetsDialog.module.css";
import { useCounts } from "./useCounts";

/** Reads a number field: empty means "no target". */
function parseTarget(value: string): number | null {
  const n = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Writing goals for the project and for the document in front of you.
 * Nothing nags: the numbers live in the status bar, and a missed target
 * only changes what the pace line says.
 */
export function TargetsDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const counts = useCounts();
  const settings = useAppStore((s) => s.snapshot?.project.settings);
  const activeDocId = useAppStore((s) =>
    s.activePane === "secondary" ? s.secondDocId : s.activeDocId,
  );
  const docTitle = useAppStore((s) =>
    activeDocId ? s.snapshot?.docs.get(activeDocId)?.meta.title : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const ids = {
    manuscript: useId(),
    session: useId(),
    deadline: useId(),
    unit: useId(),
    doc: useId(),
  };

  if (!settings || !counts) return null;

  const save = (patch: Partial<ProjectSettings>): void => {
    void currentSession()
      .updateSettings(patch)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const number = new Intl.NumberFormat(i18n.language);
  const unitLabel = t(
    settings.countUnit === "characters" ? "counts.unitCharacters" : "counts.unitWords",
  );

  return (
    <Dialog title={t("targets.title")} onClose={onClose}>
      <div className={styles.grid}>
        <label htmlFor={ids.unit}>{t("targets.countUnit")}</label>
        <select
          id={ids.unit}
          className={styles.input}
          value={settings.countUnit}
          onChange={(e) =>
            save({ countUnit: e.currentTarget.value as ProjectSettings["countUnit"] })
          }
        >
          <option value="words">{t("targets.unitWords")}</option>
          <option value="characters">{t("targets.unitCharacters")}</option>
        </select>
        <p className={styles.hint}>{t("targets.countUnitHint")}</p>

        <label htmlFor={ids.manuscript}>{t("targets.manuscript")}</label>
        <input
          id={ids.manuscript}
          className={styles.input}
          type="number"
          min={0}
          step={100}
          inputMode="numeric"
          defaultValue={settings.manuscriptTarget ?? ""}
          placeholder={t("targets.noTarget")}
          onBlur={(e) => save({ manuscriptTarget: parseTarget(e.currentTarget.value) })}
        />
        <p className={styles.hint}>
          {t("targets.manuscriptNow", {
            formatted: number.format(counts.manuscript),
            unit: unitLabel,
          })}
        </p>

        <label htmlFor={ids.deadline}>{t("targets.deadline")}</label>
        <input
          id={ids.deadline}
          className={styles.input}
          type="date"
          defaultValue={settings.deadline ?? ""}
          onChange={(e) => save({ deadline: e.currentTarget.value || null })}
        />
        <p className={styles.hint}>
          {counts.plan.perDay === null
            ? t("targets.deadlineHint")
            : counts.plan.overdue
              ? t("counts.overdue", {
                  formatted: number.format(counts.plan.remaining),
                  unit: unitLabel,
                })
              : t("counts.perDay", {
                  count: counts.plan.daysLeft,
                  formatted: number.format(counts.plan.perDay),
                  unit: unitLabel,
                })}
        </p>

        <label htmlFor={ids.session}>{t("targets.session")}</label>
        <input
          id={ids.session}
          className={styles.input}
          type="number"
          min={0}
          step={50}
          inputMode="numeric"
          defaultValue={settings.sessionTarget ?? ""}
          placeholder={t("targets.noTarget")}
          onBlur={(e) => save({ sessionTarget: parseTarget(e.currentTarget.value) })}
        />
        <p className={styles.hint}>{t("targets.sessionHint")}</p>

        {activeDocId && (
          <>
            <label htmlFor={ids.doc}>{t("targets.document", { title: docTitle ?? "" })}</label>
            <input
              id={ids.doc}
              key={activeDocId}
              className={styles.input}
              type="number"
              min={0}
              step={50}
              inputMode="numeric"
              defaultValue={counts.docTarget ?? ""}
              placeholder={t("targets.noTarget")}
              onBlur={(e) => {
                void currentSession()
                  .setTarget(activeDocId, parseTarget(e.currentTarget.value))
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
              }}
            />
            <p className={styles.hint}>
              {t("targets.documentNow", {
                formatted: number.format(counts.doc),
                unit: unitLabel,
              })}
            </p>
          </>
        )}
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {t("targets.saveFailed", { message: error })}
        </p>
      )}
    </Dialog>
  );
}
