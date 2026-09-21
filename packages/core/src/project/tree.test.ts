import { describe, expect, it } from "vitest";
import type { DocMeta } from "../format/types";
import { buildTree, flatten, isWithin, rootOf } from "./tree";

function meta(id: string, parent: string, order: string, kind: DocMeta["kind"] = "text"): DocMeta {
  return {
    id,
    title: id,
    kind,
    parent,
    order,
    created: "",
    modified: "",
    synopsis: "",
    trashedFrom: null,
    target: null,
    language: null,
  };
}

describe("buildTree", () => {
  it("nests by parent and sorts siblings by order key, then id", () => {
    const tree = buildTree([
      meta("B", "manuscript", "a1"),
      meta("A", "manuscript", "a0"),
      meta("C", "A", "a0"),
      meta("D", "A", "a0"), // same key as C: id breaks the tie
      meta("R", "research", "a0"),
      meta("T", "trash", "a0"),
    ]);
    expect(tree.roots.manuscript.map((n) => n.id)).toEqual(["A", "B"]);
    expect(tree.nodes.get("A")?.children.map((n) => n.id)).toEqual(["C", "D"]);
    expect(tree.roots.research.map((n) => n.id)).toEqual(["R"]);
    expect(tree.roots.trash.map((n) => n.id)).toEqual(["T"]);
    expect(tree.problems).toEqual([]);
    expect(flatten(tree).map((n) => n.id)).toEqual(["A", "C", "D", "B", "R", "T"]);
  });

  it("puts items with invalid order keys last", () => {
    const tree = buildTree([
      meta("X", "manuscript", ""),
      meta("Y", "manuscript", "a0"),
      meta("Z", "manuscript", "!!"),
    ]);
    expect(tree.roots.manuscript.map((n) => n.id)).toEqual(["Y", "X", "Z"]);
  });

  it("shows orphans under the manuscript and reports them", () => {
    const tree = buildTree([meta("A", "GONE", "a0")]);
    expect(tree.roots.manuscript.map((n) => n.id)).toEqual(["A"]);
    expect(tree.problems).toEqual([{ kind: "orphan", id: "A", missingParent: "GONE" }]);
  });

  it("breaks parent cycles without losing anything", () => {
    const tree = buildTree([
      meta("A", "B", "a0"),
      meta("B", "A", "a0"),
      meta("S", "S", "a0"),
      meta("K", "manuscript", "a0"),
    ]);
    expect(
      flatten(tree)
        .map((n) => n.id)
        .sort(),
    ).toEqual(["A", "B", "K", "S"]);
    expect(tree.problems.map((p) => p.kind).sort()).toEqual(["cycle", "orphan"]);
    // A (smallest id in the A↔B cycle) is re-homed; B hangs under it.
    expect(tree.displayParent.get("A")).toBe("manuscript");
    expect(tree.displayParent.get("B")).toBe("A");
  });

  it("answers rootOf and isWithin", () => {
    const tree = buildTree([meta("F", "trash", "a0", "folder"), meta("C", "F", "a0")]);
    expect(rootOf(tree, "C")).toBe("trash");
    expect(isWithin(tree, "C", "F")).toBe(true);
    expect(isWithin(tree, "F", "C")).toBe(false);
  });
});
