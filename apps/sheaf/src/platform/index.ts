/**
 * The only module allowed to import `@tauri-apps/*` (enforced by ESLint).
 *
 * Everything else in the frontend talks to this interface, so the shell stays
 * replaceable. If Tauri's mobile support fails us, a Capacitor build
 * implements this same surface. See docs/adr/0001-stack.md, "Escape hatch".
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `AppInfo` in src-tauri/src/lib.rs. */
export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  tauriVersion: string;
}

export type Runtime = { kind: "native"; info: AppInfo } | { kind: "browser" };

export async function detectRuntime(): Promise<Runtime> {
  if (!isTauri()) return { kind: "browser" };
  return { kind: "native", info: await invoke<AppInfo>("app_info") };
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
