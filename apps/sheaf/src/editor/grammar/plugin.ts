/**
 * Where the checker's findings live inside the editor: underlines that
 * follow the text as it is edited, and the one problem the writer has
 * opened a card for.
 *
 * Suggestions are never modal and never rewrite anything on their own
 * (brief §7): an underline appears, a click shows a card, and a tap applies.
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { SuppressionReason } from "@sheaf/core";
import styles from "./grammar.module.css";

export interface Problem {
  /** Document positions, kept up to date as the text is edited. */
  from: number;
  to: number;
  kind: string;
  message: string;
  suggestions: string[];
  /** The flagged text, for "add to dictionary". */
  text: string;
  language: string;
}

/** What the checker decided about one paragraph. */
export interface BlockLanguage {
  /** Position of the block, kept up to date as the text is edited. */
  pos: number;
  language: string;
  /** Null when the paragraph is being checked. */
  reason: SuppressionReason | null;
  /** The paragraph's text, which is what a language override is anchored to. */
  text: string;
  /** True when the writer chose this paragraph's language themselves. */
  overridden: boolean;
}

/** What the status bar says about the paragraph the cursor is in. */
export interface LanguageSummary {
  language: string;
  reason: SuppressionReason | null;
  /** The paragraph the cursor is in, for the "this paragraph" override. */
  text: string;
  overridden: boolean;
  /** How many paragraphs are being checked, and how many are left alone. */
  checked: number;
  skipped: number;
}

export interface GrammarState {
  problems: readonly Problem[];
  decorations: DecorationSet;
  /** One entry per paragraph, so the indicator can follow the cursor. */
  blocks: readonly BlockLanguage[];
  counts: { checked: number; skipped: number };
  /** The problem whose card is open. */
  open: Problem | null;
  /** True when the card was opened from the keyboard, so it takes focus. */
  openedByKeyboard: boolean;
  /** True while a check is in flight. */
  busy: boolean;
}

interface Update {
  problems?: readonly Problem[];
  blocks?: readonly BlockLanguage[];
  counts?: { checked: number; skipped: number };
  open?: Problem | null;
  openedByKeyboard?: boolean;
  busy?: boolean;
}

export const grammarKey = new PluginKey<GrammarState>("sheafGrammar");

const EMPTY: GrammarState = {
  problems: [],
  decorations: DecorationSet.empty,
  blocks: [],
  counts: { checked: 0, skipped: 0 },
  open: null,
  openedByKeyboard: false,
  busy: false,
};

function decorate(problems: readonly Problem[], state: EditorState): DecorationSet {
  return DecorationSet.create(
    state.doc,
    problems.map((problem) =>
      Decoration.inline(problem.from, problem.to, {
        class: `${styles.problem ?? ""} ${styles[problem.kind] ?? ""}`.trim(),
        "data-grammar-kind": problem.kind,
      }),
    ),
  );
}

/** Tells the plugin what the checker found. */
export function setGrammar(tr: Transaction, update: Update): Transaction {
  return tr.setMeta(grammarKey, update);
}

export function grammarState(state: EditorState): GrammarState {
  return grammarKey.getState(state) ?? EMPTY;
}

/**
 * What to say about the paragraph the cursor is in. Derived from the
 * selection rather than stored, so the indicator follows the caret between
 * checks instead of lagging behind it.
 */
export function summaryFor(state: EditorState): LanguageSummary | null {
  const { blocks, counts } = grammarState(state);
  if (blocks.length === 0) return null;
  const at = state.selection.from;
  let current = blocks[0];
  for (const block of blocks) {
    if (block.pos <= at) current = block;
    else break;
  }
  if (!current) return null;
  return {
    language: current.language,
    reason: current.reason,
    text: current.text,
    overridden: current.overridden,
    checked: counts.checked,
    skipped: counts.skipped,
  };
}

/** The problem at a position, if the writer clicked on one. */
export function problemAt(state: EditorState, pos: number): Problem | null {
  return grammarState(state).problems.find((p) => pos >= p.from && pos <= p.to) ?? null;
}

export function grammarPlugin(): Plugin<GrammarState> {
  return new Plugin<GrammarState>({
    key: grammarKey,
    state: {
      init: () => EMPTY,
      apply(tr, value, _old, newState): GrammarState {
        const update = tr.getMeta(grammarKey) as Update | undefined;
        if (update) {
          const problems = update.problems ?? value.problems;
          return {
            problems,
            decorations: update.problems ? decorate(problems, newState) : value.decorations,
            blocks: update.blocks ?? value.blocks,
            counts: update.counts ?? value.counts,
            open: update.open !== undefined ? update.open : value.open,
            openedByKeyboard: update.openedByKeyboard ?? false,
            busy: update.busy ?? value.busy,
          };
        }
        if (!tr.docChanged) return value;

        // The text moved: move the underlines with it, and drop the ones
        // whose text was edited — they are about to be checked again.
        const decorations = value.decorations.map(tr.mapping, tr.doc);
        const problems = value.problems
          .map((problem) => {
            const from = tr.mapping.map(problem.from, 1);
            const to = tr.mapping.map(problem.to, -1);
            return { ...problem, from, to };
          })
          .filter((problem) => problem.to > problem.from);
        return {
          problems,
          decorations,
          blocks: value.blocks.map((block) => ({ ...block, pos: tr.mapping.map(block.pos, 1) })),
          counts: value.counts,
          open: null, // any edit closes the card
          openedByKeyboard: false,
          busy: value.busy,
        };
      },
    },
    props: {
      decorations: (state) => grammarState(state).decorations,
      handleClick(view, pos) {
        const problem = problemAt(view.state, pos);
        const open = grammarState(view.state).open;
        if (problem === null && open === null) return false;
        view.dispatch(setGrammar(view.state.tr, { open: problem }));
        return false; // never swallow the click: the caret still moves
      },
    },
  });
}

/**
 * Opens the card for the problem the cursor is in, from the keyboard
 * (Ctrl/⌘+. — the "quick fix" convention). Returns false when there is
 * nothing under the cursor, so the shortcut falls through.
 */
export function openProblemAtCursor(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const problem = problemAt(state, state.selection.from);
  if (!problem) return false;
  dispatch?.(setGrammar(state.tr, { open: problem, openedByKeyboard: true }));
  return true;
}

/** Replaces a problem's text, closes its card, and keeps focus in the text. */
export function applySuggestion(view: EditorView, problem: Problem, replacement: string): void {
  const tr = view.state.tr;
  if (replacement === "") tr.delete(problem.from, problem.to);
  else tr.insertText(replacement, problem.from, problem.to);
  view.dispatch(setGrammar(tr, { open: null }));
  view.focus();
}

/** Removes one problem without changing the text (Ignore). */
export function dismissProblem(view: EditorView, problem: Problem): void {
  const problems = grammarState(view.state).problems.filter(
    (p) => !(p.from === problem.from && p.to === problem.to && p.message === problem.message),
  );
  view.dispatch(setGrammar(view.state.tr, { problems, open: null }));
  view.focus();
}
