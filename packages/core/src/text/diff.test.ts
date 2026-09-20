import { describe, expect, it } from "vitest";
import { diffArrays, diffParagraphs, diffWords, tokenize } from "./diff";

/** Applies an edit script to `a`; must reproduce `b`. */
function apply<T>(a: T[], ops: ReturnType<typeof diffArrays<T>>): T[] {
  const out: T[] = [];
  let i = 0;
  for (const op of ops) {
    if (op.op === "equal") {
      out.push(...a.slice(i, i + op.items.length));
      i += op.items.length;
    } else if (op.op === "delete") i += op.items.length;
    else out.push(...op.items);
  }
  return out;
}

function rand(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

describe("diffArrays", () => {
  it("finds a minimal script for small cases", () => {
    const ops = diffArrays([..."ABCABBA"], [..."CBABAC"]);
    const edits = ops.filter((o) => o.op !== "equal").reduce((n, o) => n + o.items.length, 0);
    expect(edits).toBe(5); // the classic Myers example: D = 5
    expect(apply([..."ABCABBA"], ops).join("")).toBe("CBABAC");
  });

  it("reproduces the target for random inputs", () => {
    const r = rand(42);
    for (let t = 0; t < 300; t++) {
      const a = Array.from(
        { length: Math.floor(r() * 30) },
        () => "abcd"[Math.floor(r() * 4)] as string,
      );
      const b = Array.from(
        { length: Math.floor(r() * 30) },
        () => "abcd"[Math.floor(r() * 4)] as string,
      );
      expect(apply(a, diffArrays(a, b))).toEqual(b);
    }
  });

  it("falls back to replace-all beyond the edit limit, still correctly", () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const ops = diffArrays(a, b, 10);
    expect(apply(a, ops)).toEqual(b);
  });
});

describe("tokenize", () => {
  it("splits words, spaces, punctuation and CJK characters", () => {
    expect(tokenize("She didn't go.")).toEqual(["She", " ", "didn't", " ", "go", "."]);
    expect(tokenize("灯塔在雾里")).toEqual(["灯", "塔", "在", "雾", "里"]);
  });
});

describe("diffWords", () => {
  it("marks a changed word", () => {
    expect(diffWords("The red door.", "The blue door.")).toEqual([
      { op: "equal", text: "The " },
      { op: "delete", text: "red" },
      { op: "insert", text: "blue" },
      { op: "equal", text: " door." },
    ]);
  });

  it("marks changed Chinese characters only", () => {
    expect(diffWords("她看见了灯塔。", "她看见了远处的灯塔。")).toEqual([
      { op: "equal", text: "她看见了" },
      { op: "insert", text: "远处的" },
      { op: "equal", text: "灯塔。" },
    ]);
  });
});

describe("diffParagraphs", () => {
  const snapshot = [
    "Opening line.",
    "The paragraph that got deleted.",
    "She ran to the red door.",
    "Ending.",
  ];

  it("shows a deleted paragraph as deleted, and an edit as a word-level change", () => {
    const current = ["Opening line.", "She ran to the blue door.", "Ending.", "A new last line."];
    expect(diffParagraphs(snapshot, current)).toEqual([
      { kind: "equal", text: "Opening line." },
      { kind: "deleted", text: "The paragraph that got deleted." },
      {
        kind: "changed",
        parts: [
          { op: "equal", text: "She ran to the " },
          { op: "delete", text: "red" },
          { op: "insert", text: "blue" },
          { op: "equal", text: " door." },
        ],
      },
      { kind: "equal", text: "Ending." },
      { kind: "inserted", text: "A new last line." },
    ]);
  });

  it("doesn't pair unrelated paragraphs as edits", () => {
    const result = diffParagraphs(
      ["Completely different text here."],
      ["Nothing alike at all, really."],
    );
    expect(result.map((r) => r.kind)).toEqual(["deleted", "inserted"]);
  });

  it("reports identical documents as all-equal", () => {
    expect(diffParagraphs(snapshot, snapshot).every((r) => r.kind === "equal")).toBe(true);
  });
});
