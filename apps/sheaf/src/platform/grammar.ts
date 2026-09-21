/**
 * The bridge to the offline checker (Harper, in the Rust shell).
 *
 * The browser preview has no engine, and that is a supported state, not an
 * error: the app then says "no checker for this language" in the same calm
 * way it says it for Chinese (brief §7).
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `GrammarLint` in src-tauri/src/grammar.rs. */
export interface GrammarLint {
  /** Offsets into the text that was checked, as JavaScript counts characters. */
  start: number;
  end: number;
  kind: string;
  message: string;
  /** Replacements for start..end, best first. May be empty. */
  suggestions: string[];
}

export interface CheckRequest {
  text: string;
  dialect: string;
  /** Words the writer added to this project. */
  dictionary: readonly string[];
}

/** True when an offline English checker is available in this build. */
export function hasOfflineChecker(): boolean {
  return isTauri();
}

export function checkEnglish(request: CheckRequest): Promise<GrammarLint[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<GrammarLint[]>("grammar_check", {
    text: request.text,
    dialect: request.dialect,
    dictionary: [...request.dictionary],
  });
}
