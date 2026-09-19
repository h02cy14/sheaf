import i18next from "i18next";
import "prosemirror-view/style/prosemirror.css";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../components/Icon";
import { onBeforeExit } from "../platform";
import { currentSession, useAppStore } from "../state/app-store";
import { registerEditor } from "./bridge";
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

function createController(): EditorController {
  return new EditorController({
    session: currentSession,
    plugins: () => editorPlugins(i18next.t("editor.placeholder")),
    attributes: () => ({
      class: styles.prose ?? "",
      "aria-label": i18next.t("editor.body"),
      role: "textbox",
      "aria-multiline": "true",
      spellcheck: "true",
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

/**
 * The writing surface for the active document. Text is saved through the
 * project session automatically (never a Save button); see EditorController.
 */
export function DocumentEditor() {
  const { t, i18n } = useTranslation();
  const activeDocId = useAppStore((s) => s.activeDocId);
  const meta = useAppStore((s) =>
    s.activeDocId ? s.snapshot?.docs.get(s.activeDocId)?.meta : undefined,
  );
  const [controller] = useState(createController);
  const mountRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  /** Set when the title should take focus once the active document's title field has rendered. */
  const titleFocusPending = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  useSyncExternalStore(controller.subscribe, controller.getRevision);

  useEffect(() => {
    if (mountRef.current) controller.attach(mountRef.current);
    const unregister = registerEditor({
      flush: () => controller.saver.flush(),
      focusTitle: () => {
        titleFocusPending.current = true;
        setFocusRequest((n) => n + 1);
      },
      focusBody: () => controller.focus(),
    });
    const stopExitHook = onBeforeExit(() => controller.saver.flush());
    return () => {
      unregister();
      stopExitHook();
      void controller.detach();
    };
  }, [controller]);

  useEffect(() => controller.refreshAttributes(), [controller, i18n.language]);

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
    <div className={styles.editor}>
      {ready && meta && (
        <>
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
          <div className={styles.page}>
            <input
              key={`${activeDocId}:${meta.title}`}
              ref={titleRef}
              data-doc-id={activeDocId ?? ""}
              className={styles.title}
              defaultValue={meta.title}
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
        </>
      )}
      {loadError && (
        <p className={styles.error} role="alert">
          {t("editor.loadError", { message: loadError })}
        </p>
      )}
      <div className={styles.page} hidden={!ready}>
        <div ref={mountRef} className={styles.mount} />
      </div>
      {!ready && <p className={styles.empty}>{t("project.noDocument")}</p>}
    </div>
  );
}
