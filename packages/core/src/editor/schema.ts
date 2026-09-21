/**
 * The manuscript schema: everything the editor can express, and nothing that
 * lacks an exact Markdown form (ADR 0002). Adding a node or mark here means
 * adding its Markdown mapping in `markdown.ts` and a round-trip test.
 *
 * DOM specs are only used for rendering and for cleaning pasted HTML, so
 * pasting from Word or a web page reduces to this schema automatically.
 */
import { Schema, type DOMOutputSpec } from "prosemirror-model";

/**
 * `dir="auto"` per block, not per document: a paragraph of Arabic inside an
 * English manuscript lays itself out right to left, and an English paragraph
 * inside an Arabic one does the opposite (brief §7). It is a rendering
 * attribute only — nothing about it reaches the Markdown file.
 */
const AUTO_DIR = { dir: "auto" };
const pDOM: DOMOutputSpec = ["p", AUTO_DIR, 0];
const blockquoteDOM: DOMOutputSpec = ["blockquote", AUTO_DIR, 0];
const hrDOM: DOMOutputSpec = ["hr", { class: "scene-break" }];
const brDOM: DOMOutputSpec = ["br"];
const liDOM: DOMOutputSpec = ["li", AUTO_DIR, 0];
const emDOM: DOMOutputSpec = ["em", 0];
const strongDOM: DOMOutputSpec = ["strong", 0];

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => pDOM,
    },

    heading: {
      attrs: { level: { default: 1, validate: "number" } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
        // Deeper headings from pasted content collapse to level 3.
        { tag: "h4", attrs: { level: 3 } },
        { tag: "h5", attrs: { level: 3 } },
        { tag: "h6", attrs: { level: 3 } },
      ],
      toDOM: (node) => [`h${String(node.attrs["level"])}`, AUTO_DIR, 0],
    },

    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => blockquoteDOM,
    },

    /** A scene break. Serialised as `* * *`. */
    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => hrDOM,
    },

    bullet_list: {
      content: "list_item+",
      group: "block",
      attrs: { tight: { default: true } },
      parseDOM: [{ tag: "ul", getAttrs: (dom) => ({ tight: dom.hasAttribute("data-tight") }) }],
      toDOM: (node) => ["ul", node.attrs["tight"] ? { "data-tight": "true" } : {}, 0],
    },

    ordered_list: {
      content: "list_item+",
      group: "block",
      attrs: { order: { default: 1, validate: "number" }, tight: { default: true } },
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom) => ({
            order: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) || 1 : 1,
            tight: dom.hasAttribute("data-tight"),
          }),
        },
      ],
      toDOM: (node) => [
        "ol",
        {
          ...(node.attrs["order"] === 1 ? {} : { start: String(node.attrs["order"]) }),
          ...(node.attrs["tight"] ? { "data-tight": "true" } : {}),
        },
        0,
      ],
    },

    list_item: {
      content: "paragraph block*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => liDOM,
    },

    text: { group: "inline" },

    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => brDOM,
    },
  },

  marks: {
    em: {
      parseDOM: [
        { tag: "i" },
        { tag: "em" },
        { style: "font-style=italic" },
        { style: "font-style=normal", clearMark: (m) => m.type.name === "em" },
      ],
      toDOM: () => emDOM,
    },

    strong: {
      parseDOM: [
        { tag: "strong" },
        // Google Docs wraps everything in <b style="font-weight:normal">.
        { tag: "b", getAttrs: (node) => node.style.fontWeight !== "normal" && null },
        { style: "font-weight=400", clearMark: (m) => m.type.name === "strong" },
        {
          style: "font-weight",
          getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
        },
      ],
      toDOM: () => strongDOM,
    },
  },
});
