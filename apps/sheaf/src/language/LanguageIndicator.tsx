/**
 * The calm indicator the brief asks for (§7): it says which language the
 * paragraph you are in is being treated as, and — when nothing is checking
 * it — why. It never offers to turn anything on, and it never appears as a
 * warning. Chinese reads "中文 · 未启用语法检查": a decision, not a fault.
 */
import { useTranslation } from "react-i18next";
import { useAppStore } from "../state/app-store";
import { languageName } from "./LanguageDialog";
import styles from "./LanguageIndicator.module.css";

export function LanguageIndicator({ onOpen }: { onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const status = useAppStore((s) => s.languageStatus[s.activePane]);

  if (!status) return null;

  const name = languageName(status.language, i18n.language);
  const state =
    status.reason === null ? t("language.states.checked") : t(`language.states.${status.reason}`);

  return (
    <button
      type="button"
      className={styles.indicator}
      onClick={onOpen}
      title={t("language.openSettings")}
      data-quiet={status.reason === null ? undefined : "yes"}
    >
      <span className={styles.name}>{name}</span>
      <span className={styles.dot} aria-hidden="true">
        ·
      </span>
      <span className={styles.state}>{state}</span>
    </button>
  );
}
