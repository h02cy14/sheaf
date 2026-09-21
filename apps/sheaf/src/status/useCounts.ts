/**
 * The numbers the status bar and the targets dialog show. Saved documents
 * are counted from the project index; the documents being typed in are
 * counted live (see DocumentEditor), so the totals move as you write.
 */
import {
  countFor,
  countsWithin,
  planForDeadline,
  type DeadlinePlan,
  type ProjectSettings,
  type TextCounts,
} from "@sheaf/core";
import { useMemo } from "react";
import { useAppStore } from "../state/app-store";

export interface CountsView {
  unit: ProjectSettings["countUnit"];
  /** The document in the active pane, including anything filed under it. */
  doc: number;
  /**
   * The same document split the way it was counted: words for
   * space-delimited scripts, characters for CJK. The brief (§7) asks for
   * both to be shown, because in a mixed document one number hides half the
   * story.
   */
  docBreakdown: TextCounts;
  docTarget: number | null;
  manuscript: number;
  manuscriptTarget: number | null;
  /** Written since the project was opened; negative after heavy cutting. */
  session: number;
  sessionTarget: number | null;
  deadline: string | null;
  plan: DeadlinePlan;
}

export function useCounts(): CountsView | null {
  const snapshot = useAppStore((s) => s.snapshot);
  const live = useAppStore((s) => s.live);
  const baseline = useAppStore((s) => s.sessionBaseline);
  const activeDocId = useAppStore((s) =>
    s.activePane === "secondary" ? s.secondDocId : s.activeDocId,
  );

  const docs = useMemo(() => {
    if (!snapshot) return null;
    const merged = new Map<string, { counts: TextCounts }>(snapshot.docs);
    for (const pane of Object.values(live)) {
      if (pane && merged.has(pane.docId)) merged.set(pane.docId, { counts: pane.counts });
    }
    return merged;
  }, [snapshot, live]);

  return useMemo(() => {
    if (!snapshot || !docs) return null;
    const settings = snapshot.project.settings;
    const unit = settings.countUnit;
    const manuscript = countFor(countsWithin(snapshot.tree, docs, "manuscript"), unit);
    const docCounts = activeDocId
      ? countsWithin(snapshot.tree, docs, activeDocId)
      : { words: 0, cjk: 0, characters: 0 };
    const doc = countFor(docCounts, unit);
    return {
      unit,
      doc,
      docBreakdown: docCounts,
      docTarget: activeDocId ? (snapshot.docs.get(activeDocId)?.meta.target ?? null) : null,
      manuscript,
      manuscriptTarget: settings.manuscriptTarget,
      session: manuscript - countFor(baseline, unit),
      sessionTarget: settings.sessionTarget,
      deadline: settings.deadline,
      plan: planForDeadline(manuscript, settings, new Date()),
    };
  }, [snapshot, docs, activeDocId, baseline]);
}
