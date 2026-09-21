import { parseMarkdown, schema } from "@sheaf/core";
import { describe, expect, it } from "vitest";
import { splitBatch, textBlocks } from "./blocks";

/** The text a block holds, and where a given offset in it lives. */
function mapped(markdown: string) {
  const doc = parseMarkdown(markdown);
  return textBlocks(doc).map((block) => ({
    text: block.text,
    at: (offset: number) => block.positionAt(offset),
    doc,
  }));
}

describe("textBlocks", () => {
  it("gives one entry per paragraph, heading and list item", () => {
    const blocks = mapped("# Title\n\nFirst line.\n\n- one\n- two\n");
    expect(blocks.map((b) => b.text)).toEqual(["Title", "First line.", "one", "two"]);
  });

  it("skips empty blocks, which have nothing to check", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Words.")]),
      schema.node("paragraph"),
      schema.node("paragraph", null, [schema.text("More words.")]),
    ]);
    expect(textBlocks(doc).map((b) => b.text)).toEqual(["Words.", "More words."]);
  });

  it("maps an offset back to the right place in the document", () => {
    const [block] = mapped("The keeper counted the waves.\n");
    expect(block).toBeDefined();
    if (!block) return;
    const from = block.at(4);
    const to = block.at(10);
    expect(block.doc.textBetween(from, to)).toBe("keeper");
  });

  it("maps across styled runs, where text and document positions drift apart", () => {
    // Bold and italic add positions that are not characters of the text.
    const [block] = mapped("She said **nothing at all** to the *keeper*.\n");
    expect(block?.text).toBe("She said nothing at all to the keeper.");
    if (!block) return;
    const start = block.text.indexOf("keeper");
    expect(block.doc.textBetween(block.at(start), block.at(start + 6))).toBe("keeper");
    const early = block.text.indexOf("nothing");
    expect(block.doc.textBetween(block.at(early), block.at(early + 7))).toBe("nothing");
  });

  it("maps around a hard break, which has no text of its own", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("before"),
        schema.node("hard_break"),
        schema.text("after the break"),
      ]),
    ]);
    const [block] = textBlocks(doc);
    expect(block?.text).toBe("beforeafter the break");
    if (!block) return;
    const at = block.text.indexOf("after");
    expect(doc.textBetween(block.positionAt(at), block.positionAt(at + 5))).toBe("after");
  });
});

describe("splitBatch", () => {
  const JOIN = "\n\n";
  const first = "The keeper counted the the waves.";
  const second = "She waited until the the morning.";
  const joined = [first, second].join(JOIN);

  /** Where a phrase is in the joined text, as an engine would report it. */
  const lintFor = (phrase: string, from = 0) => {
    const start = joined.indexOf(phrase, from);
    return { start, end: start + phrase.length, message: phrase };
  };

  it("gives each paragraph its own lints, with its own offsets", () => {
    const lints = [lintFor("the the"), lintFor("the the", first.length)];
    const [one, two] = splitBatch([first, second], lints, JOIN);

    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(first.slice(one?.[0]?.start ?? 0, one?.[0]?.end ?? 0)).toBe("the the");
    expect(second.slice(two?.[0]?.start ?? 0, two?.[0]?.end ?? 0)).toBe("the the");
  });

  it("drops anything that straddles the join between paragraphs", () => {
    const straddling = { start: first.length - 3, end: first.length + 5, message: "across" };
    expect(splitBatch([first, second], [straddling], JOIN)).toEqual([[], []]);
  });

  it("copes with a paragraph that produced nothing", () => {
    expect(splitBatch([first, second], [lintFor("the the")], JOIN)[1]).toEqual([]);
  });
});
