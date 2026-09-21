/**
 * The optional LanguageTool layer. The request is made by the Rust shell,
 * never by the page: the app's content security policy blocks the WebView
 * from making network requests at all, which is what keeps "your text stays
 * on this device" true by construction rather than by good intentions.
 *
 * Nothing here runs unless the writer has configured an endpoint themselves
 * (brief §7).
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { GrammarLint } from "./grammar";

export interface LanguageToolRequest {
  endpoint: string;
  text: string;
  language: string;
}

export function canUseLanguageTool(): boolean {
  return isTauri();
}

export function checkWithLanguageTool(request: LanguageToolRequest): Promise<GrammarLint[]> {
  if (!isTauri() || request.endpoint === "") return Promise.resolve([]);
  return invoke<GrammarLint[]>("languagetool_check", {
    endpoint: request.endpoint,
    text: request.text,
    language: request.language,
  });
}
