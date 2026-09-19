/**
 * A narrow link from app state to the mounted editor, which owns unsaved
 * text. App-level actions (switch document, close project, quit) call
 * `flush()` first so nothing typed is ever dropped.
 */
export interface EditorBridge {
  /** Saves any pending edits now. */
  flush(): Promise<void>;
  /** Moves keyboard focus into the document title field (text selected). */
  focusTitle(): void;
  /** Moves keyboard focus into the document body. */
  focusBody(): void;
}

let current: EditorBridge | null = null;
/** A focus request made before the editor mounted; replayed when it does. */
let pendingFocus: "title" | "body" | null = null;

export const editorBridge: EditorBridge = {
  flush: () => current?.flush() ?? Promise.resolve(),
  focusTitle: () => {
    if (current) current.focusTitle();
    else pendingFocus = "title";
  },
  focusBody: () => {
    if (current) current.focusBody();
    else pendingFocus = "body";
  },
};

export function registerEditor(bridge: EditorBridge): () => void {
  current = bridge;
  if (pendingFocus === "title") bridge.focusTitle();
  if (pendingFocus === "body") bridge.focusBody();
  pendingFocus = null;
  return () => {
    if (current === bridge) current = null;
  };
}
