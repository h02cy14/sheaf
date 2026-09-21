import { parseMarkdown } from "@sheaf/core";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { grammarPlugin, grammarState, setGrammar, summaryFor, type Problem } from "./plugin";

function stateWith(markdown: string): EditorState {
  return EditorState.create({ doc: parseMarkdown(markdown), plugins: [grammarPlugin()] });
}

function withCursorIn(state: EditorState, text: string): EditorState {
  let at = 0;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent.includes(text)) at = pos + 1;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

const problem = (from: number, to: number): Problem => ({
  from,
  to,
  kind: "repetition",
  message: "Repeated word",
  suggestions: ["the"],
  text: "the the",
  language: "en",
});

describe("the grammar plugin", () => {
  it("keeps underlines on the words they belong to when text is inserted before them", () => {
    let state = stateWith("The keeper counted the the waves.\n");
    const text = state.doc.textBetween(20, 27);
    expect(text).toBe("the the");

    state = state.apply(setGrammar(state.tr, { problems: [problem(20, 27)] }));
    state = state.apply(state.tr.insertText("Late one night, ", 1));

    const [moved] = grammarState(state).problems;
    expect(moved).toBeDefined();
    if (!moved) return;
    expect(state.doc.textBetween(moved.from, moved.to)).toBe("the the");
  });

  it("drops an underline once its own words are edited", () => {
    let state = stateWith("The keeper counted the the waves.\n");
    state = state.apply(setGrammar(state.tr, { problems: [problem(20, 27)] }));
    state = state.apply(state.tr.delete(20, 27));
    expect(grammarState(state).problems).toEqual([]);
  });

  it("closes an open card as soon as anything is typed", () => {
    let state = stateWith("The keeper counted the the waves.\n");
    state = state.apply(
      setGrammar(state.tr, { problems: [problem(20, 27)], open: problem(20, 27) }),
    );
    expect(grammarState(state).open).not.toBeNull();
    state = state.apply(state.tr.insertText("x", 1));
    expect(grammarState(state).open).toBeNull();
  });

  it("reports the language of the paragraph the cursor is in", () => {
    let state = stateWith("The keeper counted the waves.\n\n她在灯塔旁等待了很久。\n");
    const blocks = [
      { pos: 0, language: "en", reason: null },
      { pos: 31, language: "zh", reason: "chinese" as const },
    ];
    state = state.apply(setGrammar(state.tr, { blocks, counts: { checked: 1, skipped: 1 } }));

    const inEnglish = summaryFor(withCursorIn(state, "keeper"));
    expect(inEnglish).toMatchObject({ language: "en", reason: null, checked: 1, skipped: 1 });

    const inChinese = summaryFor(withCursorIn(state, "灯塔"));
    expect(inChinese).toMatchObject({ language: "zh", reason: "chinese" });
  });

  it("says nothing at all before the first check", () => {
    expect(summaryFor(stateWith("Words.\n"))).toBeNull();
  });
});
