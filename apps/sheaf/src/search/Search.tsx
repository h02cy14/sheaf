/**
 * Project search (brief §5). Substring matching over titles, synopses and
 * text, served by the local index — it works in any script, so a two-
 * character Chinese word finds what it should without a word segmenter.
 */
import type { SearchResult } from "@sheaf/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { currentSession, useAppStore } from "../state/app-store";
import styles from "./Search.module.css";

const DEBOUNCE_MS = 180;

let focusRequest: (() => void) | null = null;

/** Puts the cursor in the search field (Ctrl/⌘+F). */
export function requestSearchFocus(): void {
  focusRequest?.();
}

export function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focusRequest = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    return () => {
      focusRequest = null;
    };
  }, []);

  return (
    <div className={styles.field}>
      <Icon name="search" size={15} />
      <input
        ref={ref}
        type="search"
        className={styles.input}
        value={value}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value !== "") {
            e.stopPropagation();
            onChange("");
          }
        }}
      />
      {value !== "" && (
        <button
          type="button"
          className={styles.clear}
          aria-label={t("search.clear")}
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function SearchResults({ query, onOpened }: { query: string; onOpened?: () => void }) {
  const { t } = useTranslation();
  const openDocument = useAppStore((s) => s.openDocument);
  const setSelection = useAppStore((s) => s.setSelection);
  const titles = useAppStore((s) => s.snapshot?.docs);
  const revision = useAppStore((s) => s.snapshot?.revision);
  const [found, setFound] = useState<{ query: string; results: SearchResult[] } | null>(null);
  const needle = query.trim();
  // Results from an older query are "still loading", never shown as answers.
  const results = found?.query === needle ? found.results : null;

  useEffect(() => {
    if (needle === "") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void currentSession()
        .search(needle)
        .then(
          (hits) => {
            if (!cancelled) setFound({ query: needle, results: hits });
          },
          () => {
            if (!cancelled) setFound({ query: needle, results: [] });
          },
        );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needle, revision]);

  if (needle === "") return null;
  if (results === null) return <p className={styles.note}>{t("common.loading")}</p>;
  if (results.length === 0) return <p className={styles.note}>{t("search.none", { query })}</p>;

  return (
    <ul className={styles.results} aria-label={t("search.resultsLabel", { count: results.length })}>
      {results.map((result) => (
        <li key={`${result.id}:${result.field}`}>
          <button
            type="button"
            className={styles.result}
            onClick={() => {
              setSelection([result.id]);
              void openDocument(result.id);
              onOpened?.();
            }}
          >
            <span className={styles.resultTitle}>
              {titles?.get(result.id)?.meta.title ?? t("session.untitled")}
              <span className={styles.where}>{t(`search.fields.${result.field}`)}</span>
            </span>
            <span className={styles.snippet} dir="auto">
              {result.snippet}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
