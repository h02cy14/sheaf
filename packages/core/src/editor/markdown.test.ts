import type { Mark, Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { schema } from "./schema";

// ---------------------------------------------------------------- builders

type Inline = PMNode | string;
const n = schema.nodes;
const strong = schema.marks["strong"].create();
const em = schema.marks["em"].create();

function inline(content: Inline[]): PMNode[] {
  return content.map((c) => (typeof c === "string" ? schema.text(c) : c));
}
const t = (text: string, ...marks: Mark[]): PMNode => schema.text(text, marks);
const doc = (...blocks: PMNode[]): PMNode => n["doc"].create(null, blocks);
const p = (...content: Inline[]): PMNode => n["paragraph"].create(null, inline(content));
const h = (level: number, ...content: Inline[]): PMNode =>
  n["heading"].create({ level }, inline(content));
const quote = (...blocks: PMNode[]): PMNode => n["blockquote"].create(null, blocks);
const hr = (): PMNode => n["horizontal_rule"].create();
const br = (): PMNode => n["hard_break"].create();
const li = (...blocks: PMNode[]): PMNode => n["list_item"].create(null, blocks);
const ul = (...items: PMNode[]): PMNode => n["bullet_list"].create({ tight: true }, items);
const ulLoose = (...items: PMNode[]): PMNode => n["bullet_list"].create({ tight: false }, items);
const ol = (order: number, ...items: PMNode[]): PMNode =>
  n["ordered_list"].create({ order, tight: true }, items);

function roundTrip(d: PMNode): PMNode {
  return parseMarkdown(serializeMarkdown(d));
}

function expectRoundTrip(d: PMNode): void {
  const md = serializeMarkdown(d);
  const back = parseMarkdown(md);
  expect(back.toJSON(), `markdown was:\n${md}`).toEqual(d.toJSON());
}

// ------------------------------------------------------------------ tests

describe("structure round trip", () => {
  it.each<[string, PMNode]>([
    ["paragraphs", doc(p("One."), p("Two."))],
    ["headings 1–3", doc(h(1, "Part"), h(2, "Chapter"), h(3, "Scene"), p("Text"))],
    ["scene break", doc(p("Before."), hr(), p("After."))],
    ["hard breaks", doc(p("Line one", br(), "line two", br(), "line three"))],
    ["block quote", doc(quote(p("Quoted"), p("Still quoted")), p("After"))],
    ["nested quote", doc(quote(p("Outer"), quote(p("Inner"))))],
    ["bullet list", doc(ul(li(p("a")), li(p("b")), li(p("c"))))],
    ["loose bullet list", doc(ulLoose(li(p("a")), li(p("b"))))],
    ["ordered list from 3", doc(ol(3, li(p("three")), li(p("four"))))],
    ["ordered list to 10", doc(ol(1, ...Array.from({ length: 10 }, (_, i) => li(p(`item ${i}`)))))],
    ["nested list", doc(ul(li(p("a"), ul(li(p("a1")), li(p("a2")))), li(p("b"))))],
    ["list inside quote", doc(quote(ul(li(p("x")), li(p("y")))))],
    ["empty paragraph", doc(p("Before"), p(), p("After"))],
    ["several empty paragraphs", doc(p(), p(), p("x"), p(), p())],
    ["only an empty paragraph", doc(p())],
  ])("%s", (_name, d) => expectRoundTrip(d));
});

describe("inline formatting round trip", () => {
  it.each<[string, PMNode]>([
    ["bold", doc(p("a ", t("bold", strong), " b"))],
    ["italic", doc(p("a ", t("italic", em), " b"))],
    ["bold italic", doc(p(t("both", strong, em)))],
    ["overlapping marks", doc(p(t("bold ", strong), t("both", strong, em), t("italic", em)))],
    ["adjacent bullet lists stay separate", doc(ul(li(p("a"))), ul(li(p("b"))), ul(li(p("c"))))],
    ["adjacent ordered lists stay separate", doc(ol(1, li(p("a"))), ol(1, li(p("b"))))],
    ["mark at paragraph edges", doc(p(t("Start", em), " middle ", t("end", strong)))],
    ["bold in heading", doc(h(2, "The ", t("Lighthouse", em)))],
    ["heading ending in #", doc(h(1, "Take #"), h(2, "#"), h(3, "C# and F#"))],
    ["bold across hard break", doc(p(t("one", strong), br(), t("two", strong)))],
  ])("%s", (_name, d) => expectRoundTrip(d));
});

describe("text that looks like Markdown stays text", () => {
  it.each([
    "# not a heading",
    "## also not",
    "- not a list",
    "+ not a list",
    "* not a list",
    "> not a quote",
    "1. not a list",
    "12) not a list",
    "* * *",
    "---",
    "===",
    "`not code`",
    "[not](a link)",
    "![not](an image)",
    "<b>not html</b>",
    "<strong>not a tag</strong> <em>nor this</em>",
    "Tom &amp; Jerry &#169; &copy",
    "back\\slash \\* \\",
    "snake_case_name and _underscores_",
    "*literal asterisks*",
    "**literal double**",
    "    four-space indent",
    "\ttab indent",
    "  two leading spaces",
    "50% of 3 < 4 > 2 | pipe ~ tilde",
    "a\u00A0non-breaking space",
  ])("%j", (text) => expectRoundTrip(doc(p(text))));

  it("doesn't let a bare `1.` or `+` join a preceding list", () => {
    expectRoundTrip(doc(ol(4, li(p("four"))), p("1.")));
    expectRoundTrip(doc(ul(li(p("a"))), p("+")));
    expectRoundTrip(doc(ol(1, li(p("x"))), p("2)")));
  });

  it("escapes line-start syntax after a hard break", () => {
    for (const text of ["# x", "- x", "> x", "1. x", "1) x", "* * *", "==="]) {
      expectRoundTrip(doc(p("before", br(), text)));
    }
  });
});

describe("Chinese, Japanese and Korean", () => {
  it.each<[string, PMNode]>([
    ["plain Chinese", doc(p("她推开门，看见了灯塔。「你来了。」他说。"))],
    ["bold ending in CJK punctuation before CJK text", doc(p(t("「重要」", strong), "的事情"))],
    ["bold after CJK text, ending in punctuation", doc(p("这是", t("加粗。", strong), "后面"))],
    ["italic between CJK characters", doc(p("中文", t("斜体", em), "中文"))],
    ["bold full-width comma then text", doc(p(t("你好，", strong), "世界"))],
    ["《书名》 in bold", doc(p("读了", t("《红楼梦》", strong), "一遍"))],
    ["Japanese", doc(p(t("「これ」", strong), "は日本語です。"))],
    ["Korean", doc(p("한국어 ", t("굵게", strong), " 텍스트"))],
    ["mixed English inside Chinese", doc(p("他说", t("hello", em), "然后离开了。"))],
    ["full-width space at start", doc(p("\u3000\u3000段落开头"))],
  ])("%s", (_name, d) => expectRoundTrip(d));
});

describe("emphasis boundaries that CommonMark can't express directly", () => {
  it.each<[string, PMNode]>([
    ["bold ending in punctuation before a letter", doc(p(t("Hello,", strong), "world"))],
    ["italic quote before a letter", doc(p(t('"Stop!"', em), "he said"))],
    ["bold starting with punctuation after a letter", doc(p("word", t(",bold", strong)))],
    ["bold italic ending in punctuation", doc(p(t("Wait?", strong, em), "No"))],
  ])("%s", (_name, d) => expectRoundTrip(d));

  it("keeps the invisible marker out of the parsed text", () => {
    const back = roundTrip(doc(p(t("Hello,", strong), "world")));
    expect(back.textContent).toBe("Hello,world");
  });

  it("falls back to tags when Markdown can't express the emphasis", () => {
    const d = doc(p(t("&1.", strong), t("，)1.&#", strong, em), t(".。", em)));
    const md = serializeMarkdown(d);
    expect(md).toContain("<strong>");
    expect(parseMarkdown(md).toJSON()).toEqual(d.toJSON());
  });

  it("uses plain Markdown for ordinary emphasis", () => {
    const md = serializeMarkdown(
      doc(p("A ", t("bold", strong), " and ", t("italic", em), " word.")),
    );
    expect(md).toBe("A **bold** and *italic* word.\n");
  });
});

describe("other scripts", () => {
  it.each<[string, PMNode]>([
    ["emoji and ZWJ sequences", doc(p("👩\u200D👩\u200D👧 family ", t("🎉", strong)))],
    ["combining marks", doc(p("Ame\u0301lie cafe\u0301"))],
    ["Arabic", doc(p("مرحبا ", t("بالعالم", strong)))],
    ["Hebrew with English", doc(p("שלום world ", t("עולם", em)))],
    ["Thai", doc(p("สวัสดีครับ"))],
  ])("%s", (_name, d) => expectRoundTrip(d));
});

describe("documented normalisations", () => {
  it("drops whitespace at the end of a paragraph", () => {
    expect(roundTrip(doc(p("trailing   ")))).toEqual(doc(p("trailing")));
  });

  it("drops a hard break at the end of a paragraph", () => {
    expect(roundTrip(doc(p("text", br())))).toEqual(doc(p("text")));
  });

  it("may move whitespace at the edge of bold/italic outside the mark", () => {
    const back = roundTrip(doc(p(t("bold ", strong), t("both", strong, em), t(" italic", em))));
    expect(back.textContent).toBe("bold both italic");
    expect(back).toEqual(doc(p(t("bold ", strong), t("both", strong, em), " ", t("italic", em))));
  });

  it("removes U+2060 WORD JOINER", () => {
    expect(roundTrip(doc(p("a\u2060b")))).toEqual(doc(p("ab")));
  });
});

describe("reading Markdown written elsewhere", () => {
  it("never throws, and keeps the words", () => {
    const md = [
      "Title",
      "=====",
      "",
      "```js",
      "code()",
      "```",
      "",
      "<div>html</div>",
      "",
      "[link](http://x) ![img](y.png) `code` <http://auto.link>",
      "",
      "#### Deep heading",
      "",
      "| a | b |",
      "|---|---|",
    ].join("\n");
    const parsed = parseMarkdown(md);
    for (const word of ["Title", "code()", "html", "link", "img", "Deep heading"]) {
      expect(parsed.textContent).toContain(word);
    }
    expect(parsed.check()).toBeUndefined();
  });

  it("clamps headings deeper than level 3", () => {
    expect(parseMarkdown("#### Four\n")).toEqual(doc(h(3, "Four")));
  });

  it("joins soft-wrapped lines with a space", () => {
    expect(parseMarkdown("one\ntwo\n")).toEqual(doc(p("one two")));
  });

  it("accepts Windows line endings", () => {
    expect(parseMarkdown("# A\r\n\r\nB\r\n")).toEqual(doc(h(1, "A"), p("B")));
  });

  it("gives an empty file one empty paragraph", () => {
    expect(parseMarkdown("")).toEqual(doc(p()));
  });
});

describe("output format", () => {
  it("is readable Markdown with one trailing newline", () => {
    const md = serializeMarkdown(
      doc(h(1, "Chapter"), p("She ", t("ran", em), "."), hr(), ul(li(p("a")), li(p("b")))),
    );
    expect(md).toBe("# Chapter\n\nShe *ran*.\n\n* * *\n\n- a\n- b\n");
  });

  it("writes nothing for an empty document", () => {
    expect(serializeMarkdown(doc(p()))).toBe("&nbsp;\n");
  });
});

// ------------------------------------------------------------ fuzzing

/** Small deterministic PRNG so failures are reproducible from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "word",
  "Hello",
  "中文",
  "「引号」",
  "。",
  "，",
  "！",
  "《书》",
  "日本語",
  "한국",
  "مرحبا",
  "*",
  "**",
  "_",
  "`",
  "#",
  "-",
  "+",
  ">",
  "1.",
  "2)",
  "[",
  "]",
  "(",
  ")",
  "&amp;",
  "&",
  "\\",
  "<",
  "!",
  "?",
  ",",
  ".",
  '"',
  "'",
  "🙂",
  "é",
  "~",
  "=",
  "|",
];

function randomText(rand: () => number, allowEdgeSpace: boolean): string {
  let out = "";
  const count = 1 + Math.floor(rand() * 5);
  for (let i = 0; i < count; i++) {
    out += PIECES[Math.floor(rand() * PIECES.length)];
    if (rand() < 0.4) out += " ";
  }
  if (!allowEdgeSpace) out = out.trim();
  return out === "" ? "x" : out;
}

function randomParagraph(rand: () => number): PMNode {
  const content: PMNode[] = [];
  const segments = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < segments; i++) {
    const r = rand();
    if (r < 0.15 && i > 0 && i < segments - 1) {
      content.push(br());
      continue;
    }
    const marks: Mark[] = [];
    if (rand() < 0.3) marks.push(strong);
    if (rand() < 0.3) marks.push(em);
    // Marked text must not begin or end with whitespace: Markdown moves such
    // whitespace outside the delimiters (invisible, documented above).
    content.push(t(randomText(rand, false), ...marks));
    if (rand() < 0.5 && i < segments - 1) content.push(t(" "));
  }
  return p(...content);
}

function randomBlock(rand: () => number, depth: number): PMNode {
  const r = rand();
  if (depth < 2 && r < 0.1) return quote(randomBlock(rand, depth + 1));
  if (depth < 2 && r < 0.2) return ul(li(randomParagraph(rand)), li(randomParagraph(rand)));
  if (depth < 2 && r < 0.25) return ol(1 + Math.floor(rand() * 9), li(randomParagraph(rand)));
  if (r < 0.3) return h(1 + Math.floor(rand() * 3), randomText(rand, false));
  if (r < 0.33) return hr();
  if (r < 0.36) return p();
  return randomParagraph(rand);
}

describe("fuzzed round trip", () => {
  it("holds for 3000 random documents", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const rand = mulberry32(seed);
      const blocks = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => randomBlock(rand, 0));
      const d = doc(...blocks);
      const md = serializeMarkdown(d);
      expect(parseMarkdown(md).toJSON(), `seed ${seed}, markdown:\n${md}`).toEqual(d.toJSON());
    }
  });
});
