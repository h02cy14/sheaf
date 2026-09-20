/**
 * Prose diff for comparing a snapshot with the current text. Two levels:
 * paragraphs first (so a deleted paragraph shows up as exactly that), then
 * words inside paragraphs that changed. CJK characters are separate tokens,
 * so a Chinese sentence edit shows only the characters that changed.
 */

export type DiffOpKind = "equal" | "insert" | "delete";

export interface DiffPart {
  op: DiffOpKind;
  text: string;
}

export type ParagraphDiff =
  | { kind: "equal"; text: string }
  | { kind: "deleted"; text: string }
  | { kind: "inserted"; text: string }
  | { kind: "changed"; parts: DiffPart[] };

interface Op<T> {
  op: DiffOpKind;
  items: T[];
}

/**
 * Myers' O(ND) diff. Beyond `maxEdits` differences it gives up and reports
 * "delete everything, insert everything", which is still correct, just coarse.
 */
export function diffArrays<T>(a: readonly T[], b: readonly T[], maxEdits = 1500): Op<T>[] {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  const limit = Math.min(n + m, maxEdits);

  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }

  if (found < 0) {
    const ops: Op<T>[] = [];
    if (n > 0) ops.push({ op: "delete", items: [...a] });
    if (m > 0) ops.push({ op: "insert", items: [...b] });
    return ops;
  }

  // Walk the trace backwards to recover the edit script.
  const steps: { op: DiffOpKind; item: T }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (prev[offset + k - 1] as number) < (prev[offset + k + 1] as number))
        ? k + 1
        : k - 1;
    const prevX = prev[offset + prevK] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push({ op: "equal", item: a[x - 1] as T });
      x--;
      y--;
    }
    if (x === prevX) steps.push({ op: "insert", item: b[y - 1] as T });
    else steps.push({ op: "delete", item: a[x - 1] as T });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push({ op: "equal", item: a[x - 1] as T });
    x--;
    y--;
  }

  const ops: Op<T>[] = [];
  for (const step of steps.reverse()) {
    const last = ops[ops.length - 1];
    if (last && last.op === step.op) last.items.push(step.item);
    else ops.push({ op: step.op, items: [step.item] });
  }
  return ops;
}

const TOKEN =
  /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}\p{M}'’]+|./gsu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Word-level diff of two strings. */
export function diffWords(before: string, after: string): DiffPart[] {
  return diffArrays(tokenize(before), tokenize(after)).map((o) => ({
    op: o.op,
    text: o.items.join(""),
  }));
}

function similarity(parts: DiffPart[]): number {
  let same = 0;
  let total = 0;
  for (const p of parts) {
    const len = p.text.trim().length;
    total += len;
    if (p.op === "equal") same += len;
  }
  return total === 0 ? 1 : same / total;
}

/**
 * Within one changed region, match each new paragraph with the old paragraph
 * it most plausibly edits (in order, similarity ≥ 30%). Unmatched old
 * paragraphs were deleted; unmatched new ones were inserted.
 */
function alignHunk(deleted: readonly string[], inserted: readonly string[]): ParagraphDiff[] {
  const out: ParagraphDiff[] = [];
  let next = 0; // first old paragraph not yet emitted
  let pending: string[] = []; // new paragraphs with no old counterpart yet
  // Like a unified diff: removals are listed before additions.
  const emitUpTo = (end: number): void => {
    for (; next < end; next++) out.push({ kind: "deleted", text: deleted[next] as string });
    for (const text of pending) out.push({ kind: "inserted", text });
    pending = [];
  };
  for (const text of inserted) {
    let match = -1;
    let parts: DiffPart[] = [];
    for (let j = next; j < deleted.length; j++) {
      const candidate = diffWords(deleted[j] as string, text);
      if (similarity(candidate) >= 0.3) {
        match = j;
        parts = candidate;
        break;
      }
    }
    if (match < 0) {
      pending.push(text);
      continue;
    }
    emitUpTo(match);
    out.push({ kind: "changed", parts });
    next = match + 1;
  }
  emitUpTo(deleted.length);
  return out;
}

/** Paragraph-level diff with word-level detail for edited paragraphs. */
export function diffParagraphs(
  before: readonly string[],
  after: readonly string[],
): ParagraphDiff[] {
  const out: ParagraphDiff[] = [];
  const ops = diffArrays(before, after);
  let deleted: string[] = [];
  let inserted: string[] = [];
  const flush = (): void => {
    if (deleted.length > 0 || inserted.length > 0) out.push(...alignHunk(deleted, inserted));
    deleted = [];
    inserted = [];
  };
  for (const op of ops) {
    if (op.op === "equal") {
      flush();
      for (const text of op.items) out.push({ kind: "equal", text });
    } else if (op.op === "delete") deleted.push(...op.items);
    else inserted.push(...op.items);
  }
  flush();
  return out;
}
