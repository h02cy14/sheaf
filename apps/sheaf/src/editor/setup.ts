/**
 * ProseMirror configuration: keymaps, typing shortcuts, history, and the
 * commands the toolbar uses. The schema itself lives in @sheaf/core because
 * the on-disk format depends on it.
 */
import { schema } from "@sheaf/core";
import {
  baseKeymap,
  chainCommands,
  exitCode,
  lift,
  setBlockType,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  ellipsis,
  emDash,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { Plugin, type Command, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { grammarPlugin } from "./grammar/plugin";

const nodes = schema.nodes;
const marks = schema.marks;

const insertHardBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
  return true;
};

export const insertSceneBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const index = $from.index(0);
  if (!$from.node(0).canReplaceWith(index, index, nodes.horizontal_rule)) return false;
  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(nodes.horizontal_rule.create());
    dispatch(tr.scrollIntoView());
  }
  return true;
};

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

function blockActive(state: EditorState, type: NodeType, attrs?: Record<string, unknown>): boolean {
  const { $from, to } = state.selection;
  if (to > $from.end()) return false;
  const parent = $from.parent;
  if (parent.type !== type) return false;
  return !attrs || Object.entries(attrs).every(([k, v]) => parent.attrs[k] === v);
}

function wrappedIn(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return true;
  return false;
}

export interface ToolbarItem {
  id: string;
  /** i18n key under `editor.` */
  label:
    | "bold"
    | "italic"
    | "heading1"
    | "heading2"
    | "quote"
    | "bulletList"
    | "orderedList"
    | "sceneBreak";
  shortcut?: string;
  run: Command;
  isActive?: (state: EditorState) => boolean;
}

const toggleBlock =
  (type: NodeType, attrs?: Record<string, unknown>): Command =>
  (state, dispatch, view) =>
    blockActive(state, type, attrs)
      ? setBlockType(nodes.paragraph)(state, dispatch, view)
      : setBlockType(type, attrs)(state, dispatch, view);

const toggleWrap =
  (type: NodeType, wrap: Command): Command =>
  (state, dispatch, view) =>
    wrappedIn(state, type)
      ? type === nodes.blockquote
        ? lift(state, dispatch, view)
        : liftListItem(nodes.list_item)(state, dispatch, view)
      : wrap(state, dispatch, view);

export const toolbarItems: ToolbarItem[] = [
  {
    id: "bold",
    label: "bold",
    shortcut: "Mod-B",
    run: toggleMark(marks.strong),
    isActive: (s) => markActive(s, marks.strong),
  },
  {
    id: "italic",
    label: "italic",
    shortcut: "Mod-I",
    run: toggleMark(marks.em),
    isActive: (s) => markActive(s, marks.em),
  },
  {
    id: "h1",
    label: "heading1",
    shortcut: "Mod-Alt-1",
    run: toggleBlock(nodes.heading, { level: 1 }),
    isActive: (s) => blockActive(s, nodes.heading, { level: 1 }),
  },
  {
    id: "h2",
    label: "heading2",
    shortcut: "Mod-Alt-2",
    run: toggleBlock(nodes.heading, { level: 2 }),
    isActive: (s) => blockActive(s, nodes.heading, { level: 2 }),
  },
  {
    id: "quote",
    label: "quote",
    run: toggleWrap(nodes.blockquote, wrapIn(nodes.blockquote)),
    isActive: (s) => wrappedIn(s, nodes.blockquote),
  },
  {
    id: "bullets",
    label: "bulletList",
    run: toggleWrap(nodes.bullet_list, wrapInList(nodes.bullet_list)),
    isActive: (s) => wrappedIn(s, nodes.bullet_list),
  },
  {
    id: "numbers",
    label: "orderedList",
    run: toggleWrap(nodes.ordered_list, wrapInList(nodes.ordered_list)),
    isActive: (s) => wrappedIn(s, nodes.ordered_list),
  },
  { id: "scene", label: "sceneBreak", run: insertSceneBreak },
];

const typingShortcuts = inputRules({
  rules: [
    ...smartQuotes,
    ellipsis,
    emDash,
    textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (match) => ({
      level: match[1]?.length ?? 1,
    })),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + Number(node.attrs["order"]) === Number(match[1]),
    ),
  ],
});

const keys = keymap({
  "Mod-z": undo,
  "Shift-Mod-z": redo,
  "Mod-y": redo,
  "Mod-b": toggleMark(marks.strong),
  "Mod-i": toggleMark(marks.em),
  "Mod-Alt-0": setBlockType(nodes.paragraph),
  "Mod-Alt-1": setBlockType(nodes.heading, { level: 1 }),
  "Mod-Alt-2": setBlockType(nodes.heading, { level: 2 }),
  "Mod-Alt-3": setBlockType(nodes.heading, { level: 3 }),
  "Shift-Enter": chainCommands(exitCode, insertHardBreak),
  "Mod-Enter": chainCommands(exitCode, insertHardBreak),
  Enter: splitListItem(nodes.list_item),
  Tab: sinkListItem(nodes.list_item),
  "Shift-Tab": liftListItem(nodes.list_item),
});

/** Shows placeholder text in an empty document without touching its content. */
function placeholder(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const doc = state.doc;
        const first = doc.firstChild;
        if (
          doc.childCount !== 1 ||
          !first ||
          first.type !== nodes.paragraph ||
          first.content.size > 0
        ) {
          return null;
        }
        return DecorationSet.create(doc, [
          Decoration.node(0, first.nodeSize, { class: "is-empty", "data-placeholder": text }),
        ]);
      },
    },
  });
}

export function editorPlugins(placeholderText: string): Plugin[] {
  return [
    typingShortcuts,
    keys,
    keymap(baseKeymap),
    history(),
    placeholder(placeholderText),
    grammarPlugin(),
  ];
}
