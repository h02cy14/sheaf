/**
 * Binder commands shared by the item menu, keyboard shortcuts and the binder
 * toolbar. Each one is a single call into the project session, which writes
 * only the files it changes.
 */
import {
  childrenOf,
  isRootId,
  rootOf,
  type DocKind,
  type ProjectTree,
  type SessionSnapshot,
} from "@sheaf/core";
import i18next from "i18next";
import { editorBridge } from "../editor/bridge";
import { currentSession, useAppStore } from "../state/app-store";

/** Runs a binder action, reporting failure as a notice instead of throwing. */
async function attempt<T>(action: () => Promise<T>): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useAppStore.getState().notify(i18next.t("binder.actionFailed", { message }), "warning");
    return null;
  }
}

async function guarded(action: () => Promise<unknown>): Promise<void> {
  await attempt(action);
}

function siblings(tree: ProjectTree, id: string) {
  const parent = tree.displayParent.get(id) ?? "manuscript";
  const list = childrenOf(tree, parent);
  return { parent, list, index: list.findIndex((n) => n.id === id) };
}

/** Where a new item goes: inside a selected folder, else after the selected item. */
function placement(
  snapshot: SessionSnapshot,
  targetId: string | null,
): { parent: string; after: string | null } {
  if (!targetId || isRootId(targetId)) {
    return { parent: targetId && targetId !== "trash" ? targetId : "manuscript", after: null };
  }
  const tree = snapshot.tree;
  if (rootOf(tree, targetId) === "trash") return { parent: "manuscript", after: null };
  const doc = snapshot.docs.get(targetId);
  if (doc?.meta.kind === "folder") return { parent: targetId, after: null };
  return { parent: tree.displayParent.get(targetId) ?? "manuscript", after: targetId };
}

export async function createItem(kind: DocKind, targetId: string | null): Promise<string | null> {
  const { snapshot } = useAppStore.getState();
  if (!snapshot) return null;
  const { parent, after } = placement(snapshot, targetId);
  const created = await attempt(() => currentSession().createDocument({ kind, parent, after }));
  if (created) {
    const store = useAppStore.getState();
    store.setSelection([created]);
    await store.openDocument(created);
    // Name it right away; Enter then moves into the text.
    editorBridge.focusTitle();
  }
  return created;
}

export function trashItems(ids: string[]): Promise<void> {
  return guarded(async () => {
    const { activeDocId, openDocument } = useAppStore.getState();
    if (activeDocId && ids.includes(activeDocId)) await openDocument(null);
    await currentSession().trash(ids);
  });
}

export function restoreItems(ids: string[]): Promise<void> {
  return guarded(() => currentSession().restore(ids));
}

export function moveItems(
  ids: string[],
  targetId: string,
  position: "before" | "after" | "into",
): Promise<void> {
  return guarded(() => currentSession().move(ids, targetId, position));
}

export function moveUp(id: string): Promise<void> {
  const snapshot = useAppStore.getState().snapshot;
  if (!snapshot) return Promise.resolve();
  const { list, index } = siblings(snapshot.tree, id);
  const prev = list[index - 1];
  return prev ? moveItems([id], prev.id, "before") : Promise.resolve();
}

export function moveDown(id: string): Promise<void> {
  const snapshot = useAppStore.getState().snapshot;
  if (!snapshot) return Promise.resolve();
  const { list, index } = siblings(snapshot.tree, id);
  const next = list[index + 1];
  return next ? moveItems([id], next.id, "after") : Promise.resolve();
}

/** Makes the item the last child of the item above it. */
export function indent(id: string): Promise<void> {
  const snapshot = useAppStore.getState().snapshot;
  if (!snapshot) return Promise.resolve();
  const { list, index } = siblings(snapshot.tree, id);
  const prev = list[index - 1];
  return prev ? moveItems([id], prev.id, "into") : Promise.resolve();
}

/** Moves the item out of its folder, to just after that folder. */
export function outdent(id: string): Promise<void> {
  const snapshot = useAppStore.getState().snapshot;
  if (!snapshot) return Promise.resolve();
  const parent = snapshot.tree.displayParent.get(id);
  return parent && !isRootId(parent) ? moveItems([id], parent, "after") : Promise.resolve();
}

export function keepConflictCopy(path: string): Promise<void> {
  return guarded(() => currentSession().keepConflictAsDocument(path));
}
