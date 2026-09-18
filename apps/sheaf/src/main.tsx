import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initI18n } from "./i18n";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing the #root element");

await initI18n();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
