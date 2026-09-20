import type { ParagraphDiff } from "@sheaf/core";
import { useTranslation } from "react-i18next";
import styles from "./Diff.module.css";

/**
 * A snapshot next to the current text. Paragraphs that didn't change are
 * shown quietly; a changed paragraph shows the words (or Chinese characters)
 * that were added and removed. Screen readers get the same information
 * through the labels, not just colour.
 */
export function ParagraphDiffView({ diff }: { diff: readonly ParagraphDiff[] }) {
  const { t } = useTranslation();
  const unchanged = diff.every((part) => part.kind === "equal");

  if (unchanged) return <p className={styles.same}>{t("history.noChanges")}</p>;

  return (
    <div className={styles.diff} dir="auto">
      {diff.map((part, index) => {
        const key = `${index}:${part.kind}`;
        if (part.kind === "equal") {
          return (
            <p key={key} className={styles.equal}>
              {part.text}
            </p>
          );
        }
        if (part.kind === "deleted") {
          return (
            <p key={key} className={styles.deleted}>
              <span className={styles.tag}>{t("history.removed")}</span>
              <del>{part.text}</del>
            </p>
          );
        }
        if (part.kind === "inserted") {
          return (
            <p key={key} className={styles.inserted}>
              <span className={styles.tag}>{t("history.added")}</span>
              <ins>{part.text}</ins>
            </p>
          );
        }
        return (
          <p key={key} className={styles.changed}>
            <span className={styles.tag}>{t("history.changed")}</span>
            {part.parts.map((word, i) =>
              word.op === "equal" ? (
                <span key={i}>{word.text}</span>
              ) : word.op === "delete" ? (
                <del key={i} className={styles.del}>
                  {word.text}
                </del>
              ) : (
                <ins key={i} className={styles.ins}>
                  {word.text}
                </ins>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}
