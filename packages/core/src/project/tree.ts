/**
 * Builds the binder tree from documents' `parent`/`order` fields.
 *
 * Broken structure never hides a document: an item whose parent is missing,
 * or that sits in a parent cycle (possible after sync conflicts or hand
 * edits), is shown under the Manuscript root and reported. Files are not
 * rewritten until the user moves the item.
 */
import { compareOrder } from "../order";
import { isRootId, ROOT_IDS, type DocMeta, type RootId } from "../format/types";

export interface TreeNode {
  id: string;
  meta: DocMeta;
  children: TreeNode[];
}

export type TreeProblem =
  { kind: "orphan"; id: string; missingParent: string } | { kind: "cycle"; id: string };

export interface ProjectTree {
  roots: Record<RootId, TreeNode[]>;
  nodes: Map<string, TreeNode>;
  /** Where each document is actually shown: a document id or a root id. */
  displayParent: Map<string, string>;
  problems: TreeProblem[];
}

export function buildTree(metas: Iterable<DocMeta>): ProjectTree {
  const nodes = new Map<string, TreeNode>();
  for (const meta of metas) {
    if (!nodes.has(meta.id)) nodes.set(meta.id, { id: meta.id, meta, children: [] });
  }

  const displayParent = new Map<string, string>();
  const problems: TreeProblem[] = [];
  for (const node of nodes.values()) {
    const parent = node.meta.parent;
    if (isRootId(parent) || (nodes.has(parent) && parent !== node.id)) {
      displayParent.set(node.id, parent);
    } else {
      displayParent.set(node.id, "manuscript");
      problems.push({ kind: "orphan", id: node.id, missingParent: parent });
    }
  }

  // Anything not reachable from a root is in a parent cycle. Re-home one
  // member per cycle (the smallest id, for determinism); the rest follow.
  const childIds = new Map<string, string[]>();
  for (const [id, parent] of displayParent) {
    const list = childIds.get(parent) ?? [];
    list.push(id);
    childIds.set(parent, list);
  }
  const reached = new Set<string>();
  const visit = (start: string): void => {
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const child of childIds.get(id) ?? []) stack.push(child);
    }
  };
  for (const root of ROOT_IDS) for (const child of childIds.get(root) ?? []) visit(child);
  for (const id of [...nodes.keys()].sort()) {
    if (reached.has(id)) continue;
    const oldParent = displayParent.get(id) as string;
    childIds.set(
      oldParent,
      (childIds.get(oldParent) ?? []).filter((c) => c !== id),
    );
    displayParent.set(id, "manuscript");
    childIds.set("manuscript", [...(childIds.get("manuscript") ?? []), id]);
    problems.push({ kind: "cycle", id });
    visit(id);
  }

  const bySiblingOrder = (a: TreeNode, b: TreeNode): number => compareOrder(a.meta, b.meta);
  const roots = { manuscript: [], research: [], trash: [] } as Record<RootId, TreeNode[]>;
  for (const [id, parent] of displayParent) {
    const node = nodes.get(id) as TreeNode;
    if (isRootId(parent)) roots[parent].push(node);
    else nodes.get(parent)?.children.push(node);
  }
  for (const list of Object.values(roots)) list.sort(bySiblingOrder);
  for (const node of nodes.values()) node.children.sort(bySiblingOrder);

  return { roots, nodes, displayParent, problems };
}

/** Children of a display parent (document or root), in order. */
export function childrenOf(tree: ProjectTree, parent: string): TreeNode[] {
  if (isRootId(parent)) return tree.roots[parent];
  return tree.nodes.get(parent)?.children ?? [];
}

/** The root an item is shown under, following display parents. */
export function rootOf(tree: ProjectTree, id: string): RootId | null {
  let current = id;
  for (let guard = 0; guard <= tree.nodes.size; guard++) {
    const parent = tree.displayParent.get(current);
    if (parent === undefined) return isRootId(current) ? current : null;
    if (isRootId(parent)) return parent;
    current = parent;
  }
  return null;
}

/** True if `id` is `ancestor` or lies anywhere beneath it. */
export function isWithin(tree: ProjectTree, id: string, ancestor: string): boolean {
  let current: string | undefined = id;
  for (let guard = 0; current !== undefined && guard <= tree.nodes.size + 1; guard++) {
    if (current === ancestor) return true;
    current = tree.displayParent.get(current);
  }
  return false;
}

/** All documents in binder order (depth-first), optionally for one root. */
export function flatten(tree: ProjectTree, root?: RootId): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]): void => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  for (const r of root ? [root] : ROOT_IDS) walk(tree.roots[r]);
  return out;
}
