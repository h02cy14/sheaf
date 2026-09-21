import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../format/project-file";
import { countFor, countsWithin, planForDeadline, progress } from "./targets";
import { buildTree } from "./tree";

const settings = (patch: Partial<typeof DEFAULT_SETTINGS>) => ({ ...DEFAULT_SETTINGS, ...patch });

describe("countFor", () => {
  it("counts words plus CJK characters, or characters when asked", () => {
    const counts = { words: 10, cjk: 5, characters: 40 };
    expect(countFor(counts, "words")).toBe(15);
    expect(countFor(counts, "characters")).toBe(40);
  });
});

describe("planForDeadline", () => {
  const today = new Date("2026-09-20T09:00:00");

  it("divides what's left over the days left, counting today", () => {
    const plan = planForDeadline(
      20000,
      settings({ manuscriptTarget: 90000, deadline: "2026-09-29" }),
      today,
    );
    expect(plan).toMatchObject({ remaining: 70000, daysLeft: 10, perDay: 7000, overdue: false });
  });

  it("asks for everything today when the deadline is today", () => {
    const plan = planForDeadline(
      0,
      settings({ manuscriptTarget: 500, deadline: "2026-09-20" }),
      today,
    );
    expect(plan).toMatchObject({ daysLeft: 1, perDay: 500 });
  });

  it("reports overdue once the date has passed", () => {
    const plan = planForDeadline(
      100,
      settings({ manuscriptTarget: 500, deadline: "2026-09-19" }),
      today,
    );
    expect(plan).toMatchObject({ remaining: 400, daysLeft: 0, perDay: 400, overdue: true });
  });

  it("is quiet when the target is met, or when there is no target", () => {
    expect(
      planForDeadline(600, settings({ manuscriptTarget: 500, deadline: "2026-09-19" }), today),
    ).toMatchObject({
      remaining: 0,
      overdue: false,
    });
    expect(planForDeadline(10, settings({}), today).perDay).toBeNull();
  });
});

describe("progress", () => {
  it("is a fraction, capped at 1", () => {
    expect(progress(250, 1000)).toBe(0.25);
    expect(progress(2000, 1000)).toBe(1);
    expect(progress(10, null)).toBeNull();
  });
});

describe("countsWithin", () => {
  const meta = (id: string, parent: string, order: string) => ({
    id,
    title: id,
    kind: id.startsWith("f") ? ("folder" as const) : ("text" as const),
    parent,
    order,
    created: "",
    modified: "",
    synopsis: "",
    trashedFrom: null,
    target: null,
    language: null,
  });
  const tree = buildTree([
    meta("f1", "manuscript", "a0"),
    meta("d1", "f1", "a0"),
    meta("d2", "f1", "a1"),
    meta("d3", "manuscript", "a1"),
    meta("d4", "trash", "a0"),
  ]);
  const docs = new Map([
    ["f1", { counts: { words: 0, cjk: 0, characters: 0 } }],
    ["d1", { counts: { words: 100, cjk: 0, characters: 500 } }],
    ["d2", { counts: { words: 0, cjk: 20, characters: 20 } }],
    ["d3", { counts: { words: 7, cjk: 0, characters: 40 } }],
    ["d4", { counts: { words: 999, cjk: 0, characters: 999 } }],
  ]);

  it("adds up a folder and its children", () => {
    expect(countsWithin(tree, docs, "f1")).toEqual({ words: 100, cjk: 20, characters: 520 });
  });

  it("adds up a whole root, leaving the trash out of the manuscript", () => {
    expect(countsWithin(tree, docs, "manuscript")).toEqual({
      words: 107,
      cjk: 20,
      characters: 560,
    });
    expect(countsWithin(tree, docs, "trash").words).toBe(999);
  });

  it("is zero for an unknown id", () => {
    expect(countsWithin(tree, docs, "nope")).toEqual({ words: 0, cjk: 0, characters: 0 });
  });
});
