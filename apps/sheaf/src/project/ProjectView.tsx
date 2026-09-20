import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Binder } from "../binder/Binder";
import { createItem, keepConflictCopy } from "../binder/binder-actions";
import { Icon } from "../components/Icon";
import { DocumentEditor } from "../editor/DocumentEditor";
import { HistoryDialog } from "../history/HistoryDialog";
import { Inspector } from "../inspector/Inspector";
import { requestSearchFocus } from "../search/Search";
import { useAppStore } from "../state/app-store";
import { StatusBar } from "../status/StatusBar";
import { TargetsDialog } from "../status/TargetsDialog";
import styles from "./ProjectView.module.css";

const WIDE = "(min-width: 1100px)";
const MEDIUM = "(min-width: 720px)";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * The three first-launch surfaces (brief §6): binder, editor, inspector,
 * with the status bar's counts along the bottom. Wide screens show all
 * three; medium screens tuck the inspector into a drawer; phones show the
 * editor with both panels as drawers. Focus mode hides everything but the
 * writing.
 */
export function ProjectView() {
  const { t } = useTranslation();
  const snapshot = useAppStore((s) => s.snapshot);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const closeProject = useAppStore((s) => s.closeProject);
  const focusMode = useAppStore((s) => s.focusMode);
  const split = useAppStore((s) => s.secondDocId !== null);
  const activeDocId = useAppStore((s) =>
    s.activePane === "secondary" ? s.secondDocId : s.activeDocId,
  );

  const wide = useMedia(WIDE);
  const medium = useMedia(MEDIUM);
  const [binderOpen, setBinderOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [binderDrawer, setBinderDrawer] = useState(false);
  const [inspectorDrawer, setInspectorDrawer] = useState(false);
  const [dialog, setDialog] = useState<"targets" | "history" | null>(null);

  const binderDocked = medium && binderOpen && !focusMode;
  const inspectorDocked = wide && inspectorOpen && !focusMode;

  // Global shortcuts: new document / folder, search, focus mode, split.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const store = useAppStore.getState();
      if (e.key === "Escape") {
        setBinderDrawer(false);
        setInspectorDrawer(false);
        if (store.focusMode) store.setFocusMode(false);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "n" && !e.altKey) {
        e.preventDefault();
        const target = store.selection.at(-1) ?? null;
        void createItem(e.shiftKey ? "folder" : "text", target);
        return;
      }
      if (key === "f" && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (store.focusMode) store.setFocusMode(false);
        if (!medium) setBinderDrawer(true);
        else setBinderOpen(true);
        // Let the panel render before asking for focus.
        requestAnimationFrame(requestSearchFocus);
        return;
      }
      if (key === "d" && e.shiftKey) {
        e.preventDefault();
        store.toggleFocusMode();
        return;
      }
      if (key === "\\" || (key === "s" && e.altKey)) {
        e.preventDefault();
        store.toggleSplit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [medium]);

  if (!snapshot) return null;

  const toggleBinder = (): void => (medium ? setBinderOpen((v) => !v) : setBinderDrawer((v) => !v));
  const toggleInspector = (): void =>
    wide ? setInspectorOpen((v) => !v) : setInspectorDrawer((v) => !v);
  const conflicts = snapshot.conflicts;
  const problems = snapshot.tree.problems.length;

  return (
    <div className={styles.shell} data-focus-mode={focusMode ? "on" : undefined}>
      {!focusMode && (
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.barButton}
            onClick={toggleBinder}
            aria-label={t(
              binderDocked || binderDrawer ? "project.hideBinder" : "project.showBinder",
            )}
            aria-expanded={binderDocked || binderDrawer}
            title={t("binder.label")}
          >
            <Icon name="binder" />
          </button>
          <h1 className={styles.projectTitle}>{snapshot.project.title}</h1>
          <span className={styles.status} data-status={saveStatus} role="status" aria-live="polite">
            <Icon
              name={
                saveStatus === "saved" ? "check" : saveStatus === "error" ? "warning" : "spinner"
              }
              size={14}
            />
            <span>{t(`save.${saveStatus}`)}</span>
          </span>
          <button
            type="button"
            className={styles.barButton}
            onClick={() => setDialog("history")}
            disabled={activeDocId === null}
            aria-label={t("history.open")}
            title={t("history.open")}
          >
            <Icon name="history" />
          </button>
          <button
            type="button"
            className={styles.barButton}
            onClick={() => useAppStore.getState().toggleSplit()}
            aria-label={t(split ? "project.closeSplit" : "project.split")}
            aria-pressed={split}
            title={t(split ? "project.closeSplit" : "project.split")}
          >
            <Icon name="split" />
          </button>
          <button
            type="button"
            className={styles.barButton}
            onClick={() => useAppStore.getState().toggleFocusMode()}
            aria-label={t("project.focusMode")}
            aria-pressed={focusMode}
            title={t("project.focusMode")}
          >
            <Icon name="focus" />
          </button>
          <button
            type="button"
            className={styles.barButton}
            onClick={toggleInspector}
            aria-label={t(
              inspectorDocked || inspectorDrawer
                ? "project.hideInspector"
                : "project.showInspector",
            )}
            aria-expanded={inspectorDocked || inspectorDrawer}
            title={t("inspector.label")}
          >
            <Icon name="inspector" />
          </button>
          <button
            type="button"
            className={styles.barButton}
            onClick={() => void closeProject()}
            aria-label={t("project.close")}
            title={t("project.close")}
          >
            <Icon name="close" />
          </button>
        </header>
      )}

      {!focusMode && (conflicts.length > 0 || problems > 0) && (
        <div className={styles.banner} role="region" aria-label={t("project.attention")}>
          {conflicts.length > 0 && (
            <div>
              <p>{t("project.conflictBanner", { count: conflicts.length })}</p>
              <ul>
                {conflicts.map((c) => (
                  <li key={c.path}>
                    <code>{c.path}</code>{" "}
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => void keepConflictCopy(c.path)}
                    >
                      {t("project.keepConflict", { title: c.meta.title })}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {problems > 0 && <p>{t("project.treeProblems")}</p>}
        </div>
      )}

      <div className={styles.body}>
        {binderDocked && (
          <nav className={styles.binderPane} aria-label={t("binder.label")}>
            <Binder />
          </nav>
        )}
        <main className={styles.editorPane}>
          <DocumentEditor key={`${snapshot.project.id}:primary`} pane="primary" />
        </main>
        {split && (
          <main className={styles.editorPane} aria-label={t("project.secondPane")}>
            <DocumentEditor key={`${snapshot.project.id}:secondary`} pane="secondary" />
          </main>
        )}
        {inspectorDocked && (
          <aside className={styles.inspectorPane} aria-label={t("inspector.label")}>
            <Inspector onOpenHistory={() => setDialog("history")} />
          </aside>
        )}

        {!binderDocked && binderDrawer && !focusMode && (
          <>
            <div
              className={styles.scrim}
              onClick={() => setBinderDrawer(false)}
              aria-hidden="true"
            />
            <nav
              className={`${styles.drawer} ${styles.drawerStart}`}
              aria-label={t("binder.label")}
            >
              <Binder onOpened={() => setBinderDrawer(false)} />
            </nav>
          </>
        )}
        {!inspectorDocked && inspectorDrawer && !focusMode && (
          <>
            <div
              className={styles.scrim}
              onClick={() => setInspectorDrawer(false)}
              aria-hidden="true"
            />
            <aside
              className={`${styles.drawer} ${styles.drawerEnd}`}
              aria-label={t("inspector.label")}
            >
              <Inspector onOpenHistory={() => setDialog("history")} />
            </aside>
          </>
        )}
      </div>

      {!focusMode && <StatusBar onOpenTargets={() => setDialog("targets")} />}
      {focusMode && (
        <button
          type="button"
          className={styles.leaveFocus}
          onClick={() => useAppStore.getState().setFocusMode(false)}
        >
          {t("project.leaveFocusMode")}
        </button>
      )}

      {dialog === "targets" && <TargetsDialog onClose={() => setDialog(null)} />}
      {dialog === "history" && activeDocId !== null && (
        <HistoryDialog docId={activeDocId} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
