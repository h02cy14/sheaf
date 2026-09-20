/**
 * A narrow link from app state to the mounted editors, which own unsaved
 * text. App-level actions (switch document, close project, quit) call
 * `flush()` first so nothing typed is ever dropped.
 *
 * There is one editor per pane (the split view has two), so requests either
 * go to every pane (flush, replace) or to the focused one (focus).
 */
import type { PaneId } from "../state/panes";

export interface EditorBridge {
  /** Saves any pending edits now. */
  flush(): Promise<void>;
  /** Moves keyboard focus into the document title field (text selected). */
  focusTitle(): void;
  /** Moves keyboard focus into the document body. */
  focusBody(): void;
  /** Shows `body` for `docId`, replacing what the editor holds (a restore). */
  replace(docId: string, body: string): void;
}

const panes = new Map<PaneId, EditorBridge>();
/** A focus request made before the editor mounted; replayed when it does. */
let pendingFocus: { pane: PaneId; what: "title" | "body" } | null = null;

let focusedPane: PaneId = "primary";

function focused(): EditorBridge | null {
  return panes.get(focusedPane) ?? panes.get("primary") ?? null;
}

/** Which pane keyboard focus requests go to. */
export function setFocusedPane(pane: PaneId): void {
  focusedPane = pane;
}

export const editorBridge = {
  flush: async (): Promise<void> => {
    await Promise.all([...panes.values()].map((p) => p.flush()));
  },
  focusTitle: (): void => {
    const bridge = focused();
    if (bridge) bridge.focusTitle();
    else pendingFocus = { pane: focusedPane, what: "title" };
  },
  focusBody: (): void => {
    const bridge = focused();
    if (bridge) bridge.focusBody();
    else pendingFocus = { pane: focusedPane, what: "body" };
  },
  /** Used after restoring a snapshot: every pane showing the document updates. */
  replace: (docId: string, body: string): void => {
    for (const pane of panes.values()) pane.replace(docId, body);
  },
};

export function registerEditor(pane: PaneId, bridge: EditorBridge): () => void {
  panes.set(pane, bridge);
  if (pendingFocus && (pendingFocus.pane === pane || panes.size === 1)) {
    if (pendingFocus.what === "title") bridge.focusTitle();
    else bridge.focusBody();
    pendingFocus = null;
  }
  return () => {
    if (panes.get(pane) === bridge) panes.delete(pane);
  };
}
