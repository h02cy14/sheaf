import { progress } from "@sheaf/core";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { LanguageIndicator } from "../language/LanguageIndicator";
import styles from "./StatusBar.module.css";
import { useCounts } from "./useCounts";

/** One number, with a progress bar when there is a target to compare it with. */
function Meter({
  label,
  value,
  fraction,
}: {
  label: string;
  value: string;
  fraction: number | null;
}) {
  return (
    <span className={styles.meter}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {fraction !== null && (
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} style={{ inlineSize: `${Math.round(fraction * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

/**
 * Word counts, targets and pace (brief §5). Counting is language-aware:
 * Chinese, Japanese and Korean characters count as characters and
 * everything else as words, so the number means something in any script.
 */
export function StatusBar({
  onOpenTargets,
  onOpenLanguage,
}: {
  onOpenTargets: () => void;
  onOpenLanguage: () => void;
}) {
  const { t, i18n } = useTranslation();
  const counts = useCounts();
  if (!counts) return null;

  const number = new Intl.NumberFormat(i18n.language);
  const unitWord = t(counts.unit === "characters" ? "counts.unitCharacters" : "counts.unitWords");
  const unit = (n: number): string =>
    t(counts.unit === "characters" ? "counts.characters" : "counts.words", {
      count: n,
      formatted: number.format(n),
    });
  const withTarget = (value: number, target: number | null): string =>
    target === null
      ? unit(value)
      : t("counts.ofTarget", { current: number.format(value), target: number.format(target) });

  const { plan } = counts;
  const pace =
    plan.perDay === null
      ? null
      : plan.overdue
        ? t("counts.overdue", { formatted: number.format(plan.remaining), unit: unitWord })
        : t("counts.perDay", {
            count: plan.daysLeft,
            formatted: number.format(plan.perDay),
            unit: unitWord,
          });

  const session = counts.session;
  return (
    <footer className={styles.bar} aria-label={t("counts.label")}>
      <Meter
        label={t("counts.document")}
        value={withTarget(counts.doc, counts.docTarget)}
        fraction={progress(counts.doc, counts.docTarget)}
      />
      <Meter
        label={t("counts.manuscript")}
        value={withTarget(counts.manuscript, counts.manuscriptTarget)}
        fraction={progress(counts.manuscript, counts.manuscriptTarget)}
      />
      <Meter
        label={t("counts.session")}
        value={
          counts.sessionTarget === null
            ? t("counts.delta", {
                formatted: `${session > 0 ? "+" : ""}${number.format(session)}`,
                unit: unitWord,
              })
            : withTarget(Math.max(0, session), counts.sessionTarget)
        }
        fraction={progress(Math.max(0, session), counts.sessionTarget)}
      />
      <LanguageIndicator onOpen={onOpenLanguage} />
      {pace !== null && (
        <span className={styles.pace} data-overdue={plan.overdue ? "yes" : undefined}>
          {pace}
        </span>
      )}
      <button type="button" className={styles.button} onClick={onOpenTargets}>
        <Icon name="target" size={15} />
        <span>{t("targets.open")}</span>
      </button>
    </footer>
  );
}
