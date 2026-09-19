import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initI18n } from "./i18n";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing the #root element");

await initI18n();

// Development only: handles for debugging and browser-driven tests.
if (import.meta.env.DEV) {
  const [{ useAppStore }, { editorBridge }] = await Promise.all([
    import("./state/app-store"),
    import("./editor/bridge"),
  ]);
  Object.assign(window, { __sheaf: { store: useAppStore, bridge: editorBridge } });
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
