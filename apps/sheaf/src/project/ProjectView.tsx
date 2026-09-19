import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Binder } from "../binder/Binder";
import { createItem, keepConflictCopy } from "../binder/binder-actions";
import { Icon } from "../components/Icon";
import { DocumentEditor } from "../editor/DocumentEditor";
import { Inspector } from "../inspector/Inspector";
import { useAppStore } from "../state/app-store";
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
 * The three first-launch surfaces (brief §6): binder, editor, inspector.
 * Wide screens show all three; medium screens tuck the inspector into a
 * drawer; phones show the editor with both panels as drawers.
 */
export function ProjectView() {
  const { t } = useTranslation();
  const snapshot = useAppStore((s) => s.snapshot);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const closeProject = useAppStore((s) => s.closeProject);

  const wide = useMedia(WIDE);
  const medium = useMedia(MEDIUM);
  const [binderOpen, setBinderOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [binderDrawer, setBinderDrawer] = useState(false);
  const [inspectorDrawer, setInspectorDrawer] = useState(false);

  const binderDocked = medium && binderOpen;
  const inspectorDocked = wide && inspectorOpen;

  // Global shortcuts: new document / folder; Escape closes drawers.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setBinderDrawer(false);
        setInspectorDrawer(false);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.key.toLowerCase() !== "n") return;
      e.preventDefault();
      const target = useAppStore.getState().selection.at(-1) ?? null;
      void createItem(e.shiftKey ? "folder" : "text", target);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!snapshot) return null;

  const toggleBinder = (): void => (medium ? setBinderOpen((v) => !v) : setBinderDrawer((v) => !v));
  const toggleInspector = (): void =>
    wide ? setInspectorOpen((v) => !v) : setInspectorDrawer((v) => !v);
  const conflicts = snapshot.conflicts;
  const problems = snapshot.tree.problems.length;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.barButton}
          onClick={toggleBinder}
          aria-label={t(binderDocked || binderDrawer ? "project.hideBinder" : "project.showBinder")}
          aria-expanded={binderDocked || binderDrawer}
          title={t("binder.label")}
        >
          <Icon name="binder" />
        </button>
        <h1 className={styles.projectTitle}>{snapshot.project.title}</h1>
        <span className={styles.status} data-status={saveStatus} role="status" aria-live="polite">
          <Icon
            name={saveStatus === "saved" ? "check" : saveStatus === "error" ? "warning" : "spinner"}
            size={14}
          />
          <span>{t(`save.${saveStatus}`)}</span>
        </span>
        <button
          type="button"
          className={styles.barButton}
          onClick={toggleInspector}
          aria-label={t(
            inspectorDocked || inspectorDrawer ? "project.hideInspector" : "project.showInspector",
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

      {(conflicts.length > 0 || problems > 0) && (
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
          <DocumentEditor key={snapshot.project.id} />
        </main>
        {inspectorDocked && (
          <aside className={styles.inspectorPane} aria-label={t("inspector.label")}>
            <Inspector />
          </aside>
        )}

        {!binderDocked && binderDrawer && (
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
        {!inspectorDocked && inspectorDrawer && (
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
              <Inspector />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
