/**
 * Markdown ⇄ ProseMirror for document bodies (ADR 0002).
 *
 * The contract is a lossless round trip for everything the editor can
 * produce, apart from these deliberate normalisations:
 * - whitespace at the very end of a paragraph, and hard breaks at the end of
 *   a paragraph, are dropped (invisible, and Markdown cannot express them);
 * - whitespace at the edge of bold/italic may move outside the mark;
 * - U+2060 WORD JOINER is reserved as an internal marker and removed on read.
 *
 * Bold and italic are written as `**`/`*`. Every marked textblock is
 * re-parsed before it is written; if Markdown would lose formatting, that
 * block uses `<strong>`/`<em>` tags instead, which the parser also reads.
 *
 * Anything else that doesn't survive `parse(serialize(doc))` is a bug, and
 * `markdown.test.ts` is where it gets caught.
 */
import MarkdownIt from "markdown-it";
import cjkFriendly from "markdown-it-cjk-friendly";
import type { Mark, Node as PMNode } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import { MarkdownParser, MarkdownSerializer, MarkdownSerializerState } from "prosemirror-markdown";
import { schema } from "./schema";

type MarkSerializerSpec = MarkdownSerializer["marks"][string];
type NodeSerializers = MarkdownSerializer["nodes"];

/**
 * MarkdownSerializerState members that exist and are relied on at runtime
 * but are marked internal in the package's typings.
 */
interface StateInternals {
  out: string;
  atBlockStart: boolean;
  closed: unknown;
  marks: Record<string, MarkSerializerSpec>;
}

function internals(state: MarkdownSerializerState): StateInternals {
  return state as unknown as StateInternals;
}

const WORD_JOINER = "\u2060";

// ---------------------------------------------------------------- parsing

function createTokenizer(): MarkdownIt {
  const md = new MarkdownIt("commonmark", { html: false, linkify: false, typographer: false });
  // Constructs outside the manuscript schema are read as plain text rather
  // than rejected, so hand-edited or imported files always open. Indented
  // code in particular must be off: novelists indent paragraphs.
  md.disable(
    [
      "code",
      "fence",
      "html_block",
      "html_inline",
      "lheading",
      "reference",
      "link",
      "image",
      "autolink",
      "backticks",
    ],
    true,
  );
  // CommonMark can't close `**` after CJK punctuation followed by a CJK
  // character (`**「重要」**的`). This extension fixes emphasis for CJK text.
  md.use(cjkFriendly);
  // Raw HTML stays disabled; only the four tags the serializer's fallback
  // writes are understood (see `htmlMarks`).
  md.inline.ruler.before("emphasis", "sheaf_mark_tags", markTags);
  return md;
}

type InlineRule = Parameters<MarkdownIt["inline"]["ruler"]["before"]>[2];

const MARK_TAG = /^<(\/?)(strong|em)>/;

const markTags: InlineRule = (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
  const match = MARK_TAG.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const closing = match[1] === "/";
    const tag = match[2] as string;
    const token = state.push(`${tag}_${closing ? "close" : "open"}`, tag, closing ? -1 : 1);
    token.markup = match[0];
  }
  state.pos += match[0].length;
  return true;
};

interface Token {
  type: string;
  hidden: boolean;
  tag: string;
  attrGet(name: string): string | null;
}

function listIsTight(tokens: readonly Token[], i: number): boolean {
  while (++i < tokens.length) {
    const token = tokens[i];
    if (token && token.type !== "list_item_open") return token.hidden;
  }
  return false;
}

const parser = new MarkdownParser(schema, createTokenizer(), {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: {
    block: "bullet_list",
    getAttrs: (_tok, tokens, i) => ({ tight: listIsTight(tokens as Token[], i) }),
  },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok, tokens, i) => ({
      order: Number((tok as Token).attrGet("start") ?? 1) || 1,
      tight: listIsTight(tokens as Token[], i),
    }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: Math.min(3, Number((tok as Token).tag.slice(1)) || 1) }),
  },
  hr: { node: "horizontal_rule" },
  hardbreak: { node: "hard_break" },
  em: { mark: "em" },
  strong: { mark: "strong" },
});

const EMPTY_PARAGRAPH_TEXT = "\u00A0"; // what `&nbsp;` decodes to

/**
 * Undo serialisation-only encodings: empty-paragraph markers, word joiners.
 * Returns null for a text node that consisted only of word joiners.
 */
function normalizeParsed(node: PMNode): PMNode | null {
  if (node.isText) {
    const text = (node.text ?? "").split(WORD_JOINER).join("");
    if (text === "") return null;
    return text === node.text ? node : schema.text(text, node.marks);
  }
  if (
    node.type === schema.nodes["paragraph"] &&
    node.childCount === 1 &&
    node.firstChild?.isText === true &&
    node.firstChild.text === EMPTY_PARAGRAPH_TEXT &&
    node.firstChild.marks.length === 0
  ) {
    return node.type.create(node.attrs);
  }
  const children: PMNode[] = [];
  node.forEach((child) => {
    const normalized = normalizeParsed(child);
    if (normalized) children.push(normalized);
  });
  // fromArray also re-joins text nodes that a removed joiner used to separate.
  return node.copy(Fragment.fromArray(children));
}

/** Parses a document body. Never throws on malformed Markdown. */
export function parseMarkdown(markdown: string): PMNode {
  const doc = parser.parse(markdown.replace(/\r\n?/g, "\n"));
  const normalized = normalizeParsed(doc);
  // A document must contain at least one block.
  return normalized && normalized.childCount > 0
    ? normalized
    : schema.nodes["doc"].create(null, schema.nodes["paragraph"].create());
}

// ------------------------------------------------------------ serialising

const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

const isPunct = (ch: string): boolean => ch !== "" && PUNCTUATION.test(ch);
const isSpace = (ch: string): boolean => ch === "" || WHITESPACE.test(ch);

/**
 * The character preceding the delimiter about to be written. At the start of
 * a block the separator from the previous block hasn't been flushed yet, so
 * `out` still ends with the previous block's text; that counts as a line
 * start (whitespace). This also makes a block's output independent of what
 * precedes it, which `markdownFormIsFaithful` relies on.
 */
function charBefore(state: MarkdownSerializerState): string {
  const internal = internals(state);
  if (internal.atBlockStart || internal.closed) return "";
  const chars = Array.from(internal.out.slice(-2));
  return chars[chars.length - 1] ?? "";
}

/** First character of the child at `index`, or "" at the end. Breaks count as whitespace. */
function charAt(parent: PMNode, index: number): string {
  if (index >= parent.childCount) return "";
  const child = parent.child(index);
  if (!child.isText) return "\n";
  return Array.from(child.text ?? "")[0] ?? "";
}

/**
 * Emphasis delimiters with the CommonMark flanking rules applied. Where a
 * delimiter would not be recognised (bold ending in punctuation directly
 * followed by a letter, as in `**Hello,**world`), a WORD JOINER is placed on
 * the inner side so the parser sees a non-punctuation neighbour. The joiner
 * is invisible and is stripped again on parse.
 *
 * This keeps common cases in plain Markdown. It is not relied on for
 * correctness: every textblock is verified, see `renderTextblock`.
 */
function delimiter(delim: string): MarkSerializerSpec {
  return {
    open: (state: MarkdownSerializerState, _mark: Mark, parent: PMNode, index: number) => {
      const before = charBefore(state);
      // Leading whitespace of the marked text is written before the delimiter
      // (expelEnclosingWhitespace), so what follows is the first non-space.
      const node = parent.child(index);
      const after = node.isText ? (Array.from((node.text ?? "").trimStart())[0] ?? "") : "\n";
      const leftFlanking =
        !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
      return leftFlanking ? delim : delim + WORD_JOINER;
    },
    close: (state: MarkdownSerializerState, _mark: Mark, parent: PMNode, index: number) => {
      const before = charBefore(state);
      // Trailing whitespace of the previous text is written after the closing
      // delimiter, so in that case a space follows it.
      const prev = index > 0 ? parent.child(index - 1) : null;
      const expelledSpace = prev?.isText === true && /\s$/u.test(prev.text ?? "");
      const after = expelledSpace ? " " : charAt(parent, index);
      const rightFlanking =
        !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
      return rightFlanking ? delim : WORD_JOINER + delim;
    },
    mixable: true,
    expelEnclosingWhitespace: true,
  };
}

const markdownMarks = { em: delimiter("*"), strong: delimiter("**") };

/**
 * Fallback for the rare textblock whose emphasis Markdown can't express
 * (e.g. differently-marked runs packed against punctuation). Tags nest
 * unambiguously, keep whitespace inside the mark, stay readable in a text
 * editor, and render as bold/italic in any Markdown viewer.
 */
const htmlMarks: Record<string, MarkSerializerSpec> = {
  em: { open: "<em>", close: "</em>", mixable: true, expelEnclosingWhitespace: false },
  strong: { open: "<strong>", close: "</strong>", mixable: true, expelEnclosingWhitespace: false },
};

/**
 * What a reader sees: each character with its marks, where marks on
 * whitespace are ignored (Markdown may move edge whitespace out of a mark).
 */
function visibleForm(block: PMNode): string {
  const parts: string[] = [];
  block.forEach((child) => {
    if (!child.isText) {
      parts.push("\n");
      return;
    }
    const marks = child.marks.map((m) => m.type.name).join("+");
    for (const ch of child.text ?? "") parts.push(WHITESPACE.test(ch) ? ch : `${ch}${marks}`);
  });
  return parts.join("\u0000");
}

interface SheafOptions {
  escapeExtraCharacters: RegExp;
  tightLists: boolean;
  /** Set on the throwaway state used for verification, to stop recursion. */
  verifying?: boolean;
}

/** True if the textblock's inline content survives a Markdown round trip. */
function markdownFormIsFaithful(block: PMNode): boolean {
  let marked = false;
  block.descendants((n) => {
    if (n.marks.length > 0) marked = true;
    return !marked;
  });
  if (!marked) return true;

  const probe = schema.nodes["doc"].create(
    null,
    schema.nodes["paragraph"].create(null, block.content),
  );
  const state = new SheafSerializerState(serializer.nodes, markdownMarks, {
    ...options,
    verifying: true,
  });
  state.renderContent(probe);
  const back = parser.parse(internals(state).out);
  const parsedBlock = normalizeParsed(back)?.firstChild;
  return (
    back.childCount === 1 &&
    parsedBlock?.type === schema.nodes["paragraph"] &&
    visibleForm(parsedBlock) === visibleForm(block)
  );
}

/** Renders inline content, falling back to tag marks if Markdown would lose formatting. */
function renderTextblock(
  state: MarkdownSerializerState,
  block: PMNode,
  fromBlockStart: boolean,
): void {
  const opts = state.options as unknown as SheafOptions;
  if (opts.verifying || markdownFormIsFaithful(block)) {
    state.renderInline(block, fromBlockStart);
    return;
  }
  const mutable = internals(state);
  const saved = mutable.marks;
  mutable.marks = htmlMarks;
  try {
    state.renderInline(block, fromBlockStart);
  } finally {
    mutable.marks = saved;
  }
}

/** How many siblings of the same type immediately precede `parent.child(index)`. */
function runPosition(parent: PMNode, index: number): number {
  const type = parent.child(index).type;
  let count = 0;
  for (let i = index - 1; i >= 0 && parent.child(i).type === type; i--) count++;
  return count;
}

// The three-argument constructor is public at runtime but typed as internal.
const SerializerStateBase = MarkdownSerializerState as unknown as new (
  nodes: NodeSerializers,
  marks: Record<string, MarkSerializerSpec>,
  options: SheafOptions,
) => MarkdownSerializerState;

class SheafSerializerState extends SerializerStateBase {
  override esc(str: string, startOfLine = false): string {
    // Text right after a hard break (`\` + newline, then any quote/list
    // indentation) starts a line too, so `# `, `- ` etc. need escaping there.
    const lineStart = startOfLine || /\\\n[> ]*$/.test(internals(this).out);
    let out = super.esc(str, lineStart);
    if (lineStart) {
      out = out
        // `1)`, and `1.` / `+` with nothing after them, start (or continue) a
        // list. Upstream only escapes `1. ` and `+ ` followed by a space.
        .replace(/^(\s*\d+)([.)])(?=\s|$)/, "$1\\$2")
        .replace(/^\+(?=\s|$)/, "\\+")
        // Leading whitespace would be stripped by the parser.
        .replace(/^[ \t]/, (ws) => (ws === " " ? "&#32;" : "&#9;"));
    }
    return out;
  }
}

const serializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    heading(state, node) {
      state.write(`${state.repeat("#", Number(node.attrs["level"]))} `);
      renderTextblock(state, node, false);
      // `# Title #` treats the trailing `#`s as an optional closing sequence.
      internals(state).out = internals(state).out.replace(/([ \t])(#+)$/, "$1\\$2");
      state.closeBlock(node);
    },
    horizontal_rule(state, node) {
      state.write("* * *");
      state.closeBlock(node);
    },
    // Two adjacent lists with the same marker would merge into one when read
    // back, so consecutive lists alternate markers (`-`/`+`, `.`/`)`).
    bullet_list(state, node, parent, index) {
      const marker = runPosition(parent, index) % 2 === 0 ? "- " : "+ ";
      state.renderList(node, "  ", () => marker);
    },
    ordered_list(state, node, parent, index) {
      const delim = runPosition(parent, index) % 2 === 0 ? "." : ")";
      const start = Number(node.attrs["order"]);
      const width = String(start + node.childCount - 1).length;
      const indent = state.repeat(" ", width + 2);
      state.renderList(node, indent, (i) => {
        const n = String(start + i);
        return `${state.repeat(" ", width - n.length)}${n}${delim} `;
      });
    },
    list_item(state, node) {
      state.renderContent(node);
    },
    paragraph(state, node) {
      // Blank lines are how Markdown separates paragraphs, so an intentionally
      // empty paragraph needs a visible marker.
      if (node.content.size === 0) state.write("&nbsp;");
      else renderTextblock(state, node, true);
      state.closeBlock(node);
    },
    text(state, node) {
      state.text(node.text ?? "");
    },
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write("\\\n");
          return;
        }
      }
    },
  },
  markdownMarks,
);

const options: SheafOptions = {
  // `&amp;` typed as text must not come back as `&`, and `<strong>` typed as
  // text must not come back as a tag.
  escapeExtraCharacters: /&(?=#?[0-9A-Za-z]+;)|<(?=\/?(?:strong|em)>)/g,
  tightLists: true,
};

/** Serialises a document body. Output uses `\n` line endings and ends with one newline. */
export function serializeMarkdown(doc: PMNode): string {
  const state = new SheafSerializerState(serializer.nodes, serializer.marks, options);
  state.renderContent(doc);
  const out = internals(state).out.replace(/\s+$/, "");
  return out === "" ? "" : `${out}\n`;
}
