/**
 * Turning the editor's document into checkable pieces, and turning what the
 * checker says back into editor positions.
 *
 * Paragraphs are the unit throughout: a paragraph is what a language is
 * detected for, what gets sent to an engine, and what gets re-checked when it
 * changes. Text is taken as the reader sees it — no Markdown syntax — so an
 * offset from the checker maps straight onto a position in the document.
 */
import type { Node as PmNode } from "prosemirror-model";

export interface TextBlock {
  /** Position of the block node itself. */
  pos: number;
  /** Plain text of the block, as the reader sees it. */
  text: string;
  /**
   * Maps an offset in `text` to a document position. Inline nodes with no
   * text of their own (a hard break) are skipped, so the mapping stays true.
   */
  positionAt(offset: number): number;
}

/** Every textblock in the document, with a text-offset to position mapping. */
export function textBlocks(doc: PmNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.textContent === "") return false;

    // One entry per text run: where it starts in the plain text, and where
    // that is in the document.
    const runs: { offset: number; pos: number }[] = [];
    let offset = 0;
    node.forEach((child, childOffset) => {
      if (!child.isText) return;
      runs.push({ offset, pos: pos + 1 + childOffset });
      offset += child.text?.length ?? 0;
    });

    const text = node.textContent;
    blocks.push({
      pos,
      text,
      positionAt(at: number): number {
        let run = runs[0];
        for (const candidate of runs) {
          if (candidate.offset <= at) run = candidate;
          else break;
        }
        if (!run) return pos + 1 + at;
        return run.pos + (at - run.offset);
      },
    });
    return false;
  });
  return blocks;
}

/**
 * Splits one engine reply back into per-paragraph results.
 *
 * Paragraphs are sent to an engine joined by `separator`, so a lint's
 * offsets are into the joined text. This puts each one back where it
 * belongs, with offsets relative to its own paragraph, and drops anything
 * that straddles the join (which would belong to neither).
 */
export function splitBatch<T extends { start: number; end: number }>(
  texts: readonly string[],
  lints: readonly T[],
  separator: string,
): T[][] {
  const out: T[][] = [];
  let offset = 0;
  for (const text of texts) {
    const end = offset + text.length;
    const start = offset;
    out.push(
      lints
        .filter((lint) => lint.start >= start && lint.end <= end)
        .map((lint) => ({ ...lint, start: lint.start - start, end: lint.end - start })),
    );
    offset = end + separator.length;
  }
  return out;
}

/** A stable key for a block's content, so unchanged text isn't re-checked. */
export function blockKey(text: string, language: string): string {
  return `${language}\u0000${text}`;
}
