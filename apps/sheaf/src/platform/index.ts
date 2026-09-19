/**
 * The only module allowed to import `@tauri-apps/*` (enforced by ESLint).
 *
 * Everything else in the frontend talks to this interface, so the shell stays
 * replaceable. If Tauri's mobile support fails us, a Capacitor build
 * implements this same surface. See docs/adr/0001-stack.md, "Escape hatch".
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrowserStorage } from "./browser-storage";
import type { Storage } from "./storage";
import { TauriStorage } from "./tauri-storage";

export { displayName, StorageError } from "./storage";
export type { AttachedProject, ProjectLocation, Storage } from "./storage";

/** Mirrors `AppInfo` in src-tauri/src/lib.rs. */
export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  tauriVersion: string;
}

export type Runtime = { kind: "native"; info: AppInfo } | { kind: "browser" };

let runtime: Promise<Runtime> | null = null;

export function detectRuntime(): Promise<Runtime> {
  runtime ??= isTauri()
    ? invoke<AppInfo>("app_info").then((info) => ({ kind: "native" as const, info }))
    : Promise.resolve({ kind: "browser" as const });
  return runtime;
}

const OS_NAMES: Readonly<Record<string, string>> = {
  windows: "Windows",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
  macos: "macOS",
};

/** Operating-system names are proper nouns, so they are not translated. */
export function osDisplayName(os: string): string {
  return OS_NAMES[os] ?? os;
}

let storage: Promise<Storage> | null = null;

export function getStorage(): Promise<Storage> {
  storage ??= detectRuntime().then((rt) => {
    if (rt.kind === "browser") return new BrowserStorage();
    const mobile = rt.info.os === "android" || rt.info.os === "ios";
    return new TauriStorage(!mobile);
  });
  return storage;
}

/**
 * Runs `flush` before the app goes away: window close on desktop, and the
 * app being backgrounded or the page unloading everywhere. Returns an
 * unsubscribe function.
 */
export function onBeforeExit(flush: () => Promise<void>): () => void {
  const onHidden = (): void => {
    if (document.visibilityState === "hidden") void flush();
  };
  const onPageHide = (): void => void flush();
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);

  let unlistenClose: (() => void) | null = null;
  let disposed = false;
  if (isTauri()) {
    const win = getCurrentWindow();
    void win
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flush();
        } finally {
          await win.destroy();
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      });
  }

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onPageHide);
    unlistenClose?.();
  };
}
