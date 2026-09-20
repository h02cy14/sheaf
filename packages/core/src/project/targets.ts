/**
 * Writing goals: how far along the manuscript is, and how much a deadline
 * asks of you per day (brief §5).
 */
import { isRootId } from "../format/types";
import type { ProjectSettings } from "../format/project-file";
import { addCounts, wordTotal, ZERO_COUNTS, type TextCounts } from "../text/count";
import { flatten, type ProjectTree, type TreeNode } from "./tree";

/** The number a target is measured against, per the project's counting unit. */
export function countFor(counts: TextCounts, unit: ProjectSettings["countUnit"]): number {
  return unit === "characters" ? counts.characters : wordTotal(counts);
}

export interface DeadlinePlan {
  /** Still to write (never negative). */
  remaining: number;
  /** Days left including today; 0 when the deadline has passed. */
  daysLeft: number;
  /** How much per day from today, or null without a target or deadline. */
  perDay: number | null;
  overdue: boolean;
}

const DAY_MS = 86_400_000;

/** Days from `today` to `deadline` (YYYY-MM-DD), counting today. */
function daysUntil(deadline: string, today: Date): number {
  const [y, m, d] = deadline.split("-").map(Number) as [number, number, number];
  const end = Date.UTC(y, m - 1, d);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((end - start) / DAY_MS) + 1;
}

export function planForDeadline(
  current: number,
  settings: ProjectSettings,
  today: Date,
): DeadlinePlan {
  const target = settings.manuscriptTarget;
  const remaining = target === null ? 0 : Math.max(0, target - current);
  if (target === null || settings.deadline === null) {
    return { remaining, daysLeft: 0, perDay: null, overdue: false };
  }
  const daysLeft = daysUntil(settings.deadline, today);
  if (daysLeft <= 0) return { remaining, daysLeft: 0, perDay: remaining, overdue: remaining > 0 };
  return { remaining, daysLeft, perDay: Math.ceil(remaining / daysLeft), overdue: false };
}

/** Progress as a fraction of the target (0–1), or null without a target. */
export function progress(current: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.min(1, current / target);
}

// ----------------------------------------------------------------- totals

/** Every node at or beneath `id` (a document id or a root id). */
function subtree(tree: ProjectTree, id: string): TreeNode[] {
  if (isRootId(id)) return flatten(tree, id);
  const node = tree.nodes.get(id);
  if (!node) return [];
  const out: TreeNode[] = [];
  const walk = (n: TreeNode): void => {
    out.push(n);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out;
}

/** Adds up the counts of a document and everything beneath it. */
export function countsWithin(
  tree: ProjectTree,
  docs: ReadonlyMap<string, { counts: TextCounts }>,
  id: string,
): TextCounts {
  let total = ZERO_COUNTS;
  for (const node of subtree(tree, id)) {
    const doc = docs.get(node.id);
    if (doc) total = addCounts(total, doc.counts);
  }
  return total;
}
