import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import styles from "./App.module.css";
import { Icon } from "./components/Icon";
import { Home } from "./home/Home";
import { ProjectView } from "./project/ProjectView";
import { useAppStore } from "./state/app-store";

/**
 * Keeps `--app-height` equal to the visible viewport, which shrinks when a
 * phone's software keyboard opens. The layout then fits above the keyboard,
 * so the caret and the toolbar stay visible while typing (brief §6).
 */
function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = (): void => root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      root.style.removeProperty("--app-height");
    };
  }, []);
}

function Notices() {
  const { t } = useTranslation();
  const notices = useAppStore((s) => s.notices);
  const dismiss = useAppStore((s) => s.dismissNotice);
  return (
    <div className={styles.notices} aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          className={styles.notice}
          data-tone={n.tone}
          role={n.tone === "warning" ? "alert" : "status"}
        >
          {n.tone === "warning" && <Icon name="warning" size={16} />}
          <span>{n.text}</span>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(n.id)}
            aria-label={t("common.dismiss")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const screen = useAppStore((s) => s.screen);
  const start = useAppStore((s) => s.start);
  const { t } = useTranslation();
  useVisualViewportHeight();

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <>
      {screen === "project" && <ProjectView />}
      {screen === "home" && <Home />}
      {(screen === "starting" || screen === "opening") && (
        <div className={styles.loading} role="status">
          <Icon name="spinner" size={24} />
          <span>{t("common.loading")}</span>
        </div>
      )}
      <Notices />
    </>
  );
}
