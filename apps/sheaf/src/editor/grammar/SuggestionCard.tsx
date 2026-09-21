/**
 * The card that appears when the writer clicks an underline (brief §7):
 * what the checker thinks, one tap to apply, and two ways to say "stop
 * telling me" — for this one, or for this word everywhere in the project.
 *
 * It is not modal. Typing anywhere closes it, and nothing is changed unless
 * the writer chooses a suggestion.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "prosemirror-view";
import { currentSession } from "../../state/app-store";
import { applySuggestion, dismissProblem, type Problem } from "./plugin";
import styles from "./SuggestionCard.module.css";

/** The card's place: just under the words it is about, kept on screen. */
const CARD_WIDTH = 320;

function cardPosition(
  view: EditorView | null,
  problem: Problem | null,
): { top: number; left: number } | null {
  if (!view || !problem) return null;
  try {
    const start = view.coordsAtPos(problem.from);
    const bounds = view.dom.getBoundingClientRect();
    const left = Math.min(
      Math.max(start.left - bounds.left, 8),
      Math.max(bounds.width - CARD_WIDTH - 8, 8),
    );
    return { top: start.bottom - bounds.top + 6, left };
  } catch {
    // The position is gone (the text was replaced under us).
    return null;
  }
}

export function SuggestionCard({
  view,
  problem,
  takeFocus = false,
  onClose,
}: {
  view: EditorView | null;
  problem: Problem | null;
  /** True when the card was opened from the keyboard: it then takes focus. */
  takeFocus?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const at = cardPosition(view, problem);
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!problem) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [problem, onClose]);

  // Opened from the keyboard: put focus on the first suggestion, so the fix
  // is one more key away. Opened by click: focus stays in the text.
  useEffect(() => {
    if (takeFocus) firstButton.current?.focus();
  }, [takeFocus, problem]);

  if (!problem || !view || !at) return null;

  const word = problem.text.trim();
  const canAddToDictionary = /^[\p{L}\p{M}'’-]+$/u.test(word);

  return (
    <div
      className={styles.card}
      style={{ top: at.top, left: at.left }}
      role="dialog"
      aria-label={t("check.cardLabel")}
    >
      <p className={styles.message}>{problem.message}</p>
      {problem.suggestions.length > 0 && (
        <div className={styles.suggestions}>
          {problem.suggestions.slice(0, 4).map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              ref={index === 0 ? firstButton : undefined}
              className={styles.suggestion}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySuggestion(view, problem, suggestion)}
            >
              {suggestion === "" ? t("check.deleteIt") : suggestion}
            </button>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.quiet}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void currentSession().ignoreLint(problem.kind, problem.text);
            dismissProblem(view, problem);
          }}
        >
          {t("check.ignore")}
        </button>
        {canAddToDictionary && (
          <button
            type="button"
            className={styles.quiet}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              void currentSession().addToDictionary(word);
              dismissProblem(view, problem);
            }}
          >
            {t("check.addToDictionary", { word })}
          </button>
        )}
      </div>
    </div>
  );
}
