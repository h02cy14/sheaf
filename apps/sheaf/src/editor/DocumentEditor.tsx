import i18next from "i18next";
import "prosemirror-view/style/prosemirror.css";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../components/Icon";
import { onBeforeExit } from "../platform";
import { countText, type TextCounts } from "@sheaf/core";
import { hasOfflineChecker } from "../platform/grammar";
import { currentSession, useAppStore } from "../state/app-store";
import type { PaneId } from "../state/panes";
import { registerEditor } from "./bridge";
import type { GrammarContext } from "./grammar/checker";
import { grammarState, summaryFor } from "./grammar/plugin";
import { SuggestionCard } from "./grammar/SuggestionCard";
import { EditorController } from "./controller";
import styles from "./DocumentEditor.module.css";
import { editorPlugins, toolbarItems } from "./setup";

const IS_APPLE = /Mac|iPhone|iPad/.test(navigator.userAgent);

function shortcutLabel(shortcut: string): string {
  return IS_APPLE
    ? shortcut.replace("Mod-", "⌘").replace("Alt-", "⌥").replace(/-/g, "")
    : shortcut
        .replace("Mod-", "Ctrl+")
        .replace("Alt-", "Alt+")
        .replace(/-(?=.)/g, "+");
}

const TOOLBAR_ICONS: Record<string, IconName> = {
  bold: "bold",
  italic: "italic",
  h1: "h1",
  h2: "h2",
  quote: "quote",
  bullets: "bullets",
  numbers: "numbers",
  scene: "scene",
};

/**
 * Everything the checker needs that lives outside the editor: the project's
 * language settings, the document's own language, and what this build can
 * actually run. Read fresh on every check, so changing a setting takes
 * effect without reloading anything.
 */
function grammarContext(pane: PaneId): GrammarContext | null {
  const state = useAppStore.getState();
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const docId = pane === "secondary" ? state.secondDocId : state.activeDocId;
  const settings = snapshot.project.settings;
  return {
    checkGrammar: settings.checkGrammar,
    languageToolEndpoint: settings.languageToolEndpoint,
    projectLanguage: settings.language,
    documentLanguage: (docId && snapshot.docs.get(docId)?.meta.language) || null,
    dialect: settings.dialect,
    dictionary: settings.dictionary,
    ignored: settings.ignored,
    available: { harper: hasOfflineChecker() },
  };
}

function createController(pane: PaneId): EditorController {
  return new EditorController({
    session: currentSession,
    plugins: () => editorPlugins(i18next.t("editor.placeholder")),
    grammarContext: () => grammarContext(pane),
    attributes: () => ({
      class: styles.prose ?? "",
      "aria-label": i18next.t("editor.body"),
      role: "textbox",
      "aria-multiline": "true",
      // Sheaf's own checker replaces the platform's where it exists, so the
      // two never disagree about the same word.
      spellcheck: hasOfflineChecker() ? "false" : "true",
    }),
    onStatus: (status) => useAppStore.getState().setSaveStatus(status),
    onConflict: (docId, copyId) => {
      const { snapshot, notify } = useAppStore.getState();
      notify(
        i18next.t("save.conflict", {
          title: snapshot?.docs.get(docId)?.meta.title ?? "",
          copy: snapshot?.docs.get(copyId)?.meta.title ?? "",
        }),
        "warning",
      );
    },
  });
}

/** How long after typing stops before the status bar's numbers catch up. */
const COUNT_DELAY_MS = 400;

/**
 * The writing surface for one pane's document. Text is saved through the
 * project session automatically (never a Save button); see EditorController.
 */
export function DocumentEditor({ pane = "primary" }: { pane?: PaneId }) {
  const { t, i18n } = useTranslation();
  const activeDocId = useAppStore((s) => (pane === "secondary" ? s.secondDocId : s.activeDocId));
  const meta = useAppStore((s) =>
    activeDocId ? s.snapshot?.docs.get(activeDocId)?.meta : undefined,
  );
  const focusMode = useAppStore((s) => s.focusMode);
  const paneActive = useAppStore((s) => s.activePane === pane);
  const split = useAppStore((s) => s.secondDocId !== null);
  const [controller] = useState(() => createController(pane));
  const mountRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  /** Set when the title should take focus once the active document's title field has rendered. */
  const titleFocusPending = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  useSyncExternalStore(controller.subscribe, controller.getRevision);

  useEffect(() => {
    if (mountRef.current) controller.attach(mountRef.current);
    const unregister = registerEditor(pane, {
      flush: () => controller.saver.flush(),
      focusTitle: () => {
        titleFocusPending.current = true;
        setFocusRequest((n) => n + 1);
      },
      focusBody: () => controller.focus(),
      replace: (docId, body) => controller.replace(docId, body),
    });
    const stopExitHook = onBeforeExit(() => controller.saver.flush());
    return () => {
      unregister();
      stopExitHook();
      void controller.detach();
    };
  }, [controller, pane]);

  useEffect(() => controller.refreshAttributes(), [controller, i18n.language]);
  useEffect(() => controller.setTypewriter(focusMode), [controller, focusMode]);

  // Counting every keystroke would walk the whole document each time; a
  // short pause is plenty for a status bar.
  const revision = controller.getRevision();
  useEffect(() => {
    const setLiveCounts = useAppStore.getState().setLiveCounts;
    if (!activeDocId) {
      setLiveCounts(pane, null);
      return;
    }
    const timer = setTimeout(() => {
      const text = controller.plainText();
      if (text === null || controller.activeId !== activeDocId) return;
      const counts: TextCounts = countText(text);
      setLiveCounts(pane, { docId: activeDocId, counts });
    }, COUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [controller, pane, activeDocId, revision]);

  useEffect(() => {
    return () => {
      useAppStore.getState().setLiveCounts(pane, null);
      useAppStore.getState().setLanguageStatus(pane, null);
    };
  }, [pane]);

  // The status bar's language indicator comes from whatever the checker last
  // decided for the paragraph the cursor is in.
  const summary = controller.state ? summaryFor(controller.state) : null;
  useEffect(() => {
    useAppStore.getState().setLanguageStatus(pane, summary);
  }, [pane, summary]);

  // Changing the language, the dialect or the dictionary re-checks at once.
  const settingsStamp = useAppStore((s) => {
    const settings = s.snapshot?.project.settings;
    if (!settings) return "";
    return [
      settings.language,
      settings.dialect,
      settings.checkGrammar,
      settings.languageToolEndpoint,
      settings.dictionary.length,
      settings.ignored.length,
    ].join("|");
  });
  const documentLanguage = useAppStore((s) =>
    activeDocId ? (s.snapshot?.docs.get(activeDocId)?.meta.language ?? null) : null,
  );
  useEffect(() => {
    controller.checker.refresh();
  }, [controller, settingsStamp, documentLanguage]);

  // Focus the title only once the field for the *active* document exists.
  useLayoutEffect(() => {
    const input = titleRef.current;
    if (!titleFocusPending.current || !input || input.dataset["docId"] !== activeDocId) return;
    titleFocusPending.current = false;
    input.focus();
    input.select();
  }, [focusRequest, activeDocId]);

  useEffect(() => {
    if (!activeDocId) {
      controller.unload();
      return;
    }
    controller.load(activeDocId).then(
      () => setLoadError(null),
      (error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)),
    );
  }, [controller, activeDocId]);

  function commitTitle(value: string): void {
    if (!activeDocId || !meta) return;
    const title = value.trim() || t("session.untitled");
    if (title !== meta.title) void currentSession().rename(activeDocId, title);
  }

  const state = controller.state;
  const ready = Boolean(activeDocId && meta);

  return (
    <div
      className={styles.editor}
      data-focus-mode={focusMode ? "on" : undefined}
      data-pane-active={split ? (paneActive ? "yes" : "no") : undefined}
      onFocusCapture={() => {
        if (!paneActive) useAppStore.getState().setActivePane(pane);
      }}
    >
      {ready && meta && !focusMode && (
        <div className={styles.toolbar} role="toolbar" aria-label={t("editor.toolbar")}>
          {toolbarItems.map((item) => {
            const label = t(`editor.${item.label}`);
            const active = state && item.isActive ? item.isActive(state) : false;
            return (
              <button
                key={item.id}
                type="button"
                className={styles.tool}
                aria-label={label}
                aria-pressed={item.isActive ? active : undefined}
                title={item.shortcut ? `${label} (${shortcutLabel(item.shortcut)})` : label}
                // Keep the text selection: don't take focus on mouse down.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => controller.run(item.run)}
              >
                <Icon name={TOOLBAR_ICONS[item.id] ?? "document"} />
              </button>
            );
          })}
        </div>
      )}
      {ready && meta && (
        <div className={styles.page}>
          <input
            key={`${activeDocId}:${meta.title}`}
            ref={titleRef}
            data-doc-id={activeDocId ?? ""}
            className={styles.title}
            defaultValue={meta.title}
            dir="auto"
            aria-label={t("editor.title")}
            placeholder={t("session.untitled")}
            onBlur={(e) => commitTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitTitle(e.currentTarget.value);
                controller.focus();
              }
            }}
          />
        </div>
      )}
      {loadError && (
        <p className={styles.error} role="alert">
          {t("editor.loadError", { message: loadError })}
        </p>
      )}
      <div className={styles.page} hidden={!ready}>
        <div className={styles.surface}>
          <div ref={mountRef} className={styles.mount} />
          <SuggestionCard
            view={controller.editorView}
            problem={controller.state ? grammarState(controller.state).open : null}
            onClose={() => controller.closeSuggestion()}
          />
        </div>
      </div>
      {!ready && <p className={styles.empty}>{t("project.noDocument")}</p>}
    </div>
  );
}
