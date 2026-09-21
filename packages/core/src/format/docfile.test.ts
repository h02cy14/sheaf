import { describe, expect, it } from "vitest";
import { parseDocFile, serializeDocFile, type DocFile } from "./docfile";

const ID = "01J9ZK3D7Q0W6Y8V4T2R5N1M0P";

function sample(overrides: Partial<DocFile["meta"]> = {}, body = "Body text.\n"): DocFile {
  return {
    meta: {
      id: ID,
      title: "The Lighthouse",
      kind: "text",
      parent: "manuscript",
      order: "a1",
      created: "2026-09-18T10:00:00.000Z",
      modified: "2026-09-18T10:42:17.311Z",
      synopsis: "Mara arrives on the island.",
      trashedFrom: null,
      target: null,
      language: null,
      ...overrides,
    },
    extra: {},
    body,
  };
}

describe("document files", () => {
  it("round-trip exactly", () => {
    const file = sample();
    const parsed = parseDocFile(serializeDocFile(file), ID);
    expect(parsed.problems).toEqual([]);
    expect(parsed.file).toEqual(file);
  });

  it("look the way ADR 0002 says", () => {
    expect(serializeDocFile(sample())).toBe(
      [
        "---",
        `id: ${ID}`,
        "title: The Lighthouse",
        "kind: text",
        "parent: manuscript",
        "order: a1",
        "created: 2026-09-18T10:00:00.000Z",
        "modified: 2026-09-18T10:42:17.311Z",
        "synopsis: Mara arrives on the island.",
        "---",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );
  });

  it.each([
    ["colon and quotes", 'Chapter 1: "Arrival"'],
    ["Chinese title", "第一章：到达"],
    ["looks like a number", "1984"],
    ["looks like a boolean", "yes"],
    ["YAML syntax", "- [not, a, list] # comment"],
    ["frontmatter fence", "---"],
    ["leading spaces", "  indented"],
    ["emoji", "🌊 Tide"],
  ])("keep tricky titles: %s", (_name, title) => {
    const file = sample({ title });
    expect(parseDocFile(serializeDocFile(file), ID).file.meta.title).toBe(title);
  });

  it("keep multi-line synopses", () => {
    const file = sample({ synopsis: "Line one.\nLine two: with colon.\n\nParagraph." });
    expect(parseDocFile(serializeDocFile(file), ID).file.meta.synopsis).toBe(file.meta.synopsis);
  });

  it("preserve unknown frontmatter keys and their order", () => {
    const file: DocFile = {
      ...sample(),
      extra: { label: "Blue", keywords: ["sea", "night"], nested: { a: 1 } },
    };
    const parsed = parseDocFile(serializeDocFile(file), ID);
    expect(parsed.file.extra).toEqual(file.extra);
    expect(Object.keys(parsed.file.extra)).toEqual(["label", "keywords", "nested"]);
  });

  it("round-trip a document target, and ignore invalid ones", () => {
    const file = sample({ target: 2500 });
    expect(parseDocFile(serializeDocFile(file), ID).file.meta.target).toBe(2500);
    const bad = serializeDocFile(sample()).replace("synopsis:", "target: lots\nsynopsis:");
    expect(parseDocFile(bad, ID).file.meta.target).toBeNull();
  });

  it("round-trip trashedFrom", () => {
    const file = sample({ parent: "trash", trashedFrom: "manuscript" });
    expect(parseDocFile(serializeDocFile(file), ID).file.meta.trashedFrom).toBe("manuscript");
  });

  it("keep an empty body empty and a body with leading blank lines intact", () => {
    expect(parseDocFile(serializeDocFile(sample({}, "")), ID).file.body).toBe("");
    expect(parseDocFile(serializeDocFile(sample({}, "\n\nAfter gap.\n")), ID).file.body).toBe(
      "\n\nAfter gap.\n",
    );
  });
});

describe("reading imperfect files keeps the words", () => {
  it("no frontmatter", () => {
    const parsed = parseDocFile("# A Title\n\nJust prose.\n", ID);
    expect(parsed.problems).toEqual(["no-frontmatter"]);
    expect(parsed.file.body).toBe("# A Title\n\nJust prose.\n");
    expect(parsed.file.meta).toMatchObject({
      id: ID,
      title: "A Title",
      parent: "manuscript",
      kind: "text",
    });
  });

  it("broken YAML", () => {
    const parsed = parseDocFile("---\ntitle: [unclosed\n---\n\nStill here.\n", ID);
    expect(parsed.problems).toEqual(["invalid-frontmatter"]);
    expect(parsed.file.body).toBe("Still here.\n");
  });

  it("missing fields get defaults", () => {
    const parsed = parseDocFile("---\ntitle: Only a title\n---\n\nText\n", ID);
    expect(parsed.problems).toEqual(["missing-fields"]);
    expect(parsed.file.meta).toMatchObject({
      id: ID,
      title: "Only a title",
      parent: "manuscript",
      kind: "text",
    });
  });

  it("empty frontmatter", () => {
    const parsed = parseDocFile("---\n---\nText\n", ID);
    expect(parsed.file.body).toBe("Text\n");
  });

  it("a byte-order mark and Windows line endings", () => {
    const text = `${String.fromCharCode(0xfeff)}---\r\nid: ${ID}\r\ntitle: T\r\nkind: text\r\nparent: manuscript\r\n---\r\n\r\nBody\r\n`;
    const parsed = parseDocFile(text, ID);
    expect(parsed.problems).toEqual([]);
    expect(parsed.file.meta.title).toBe("T");
    expect(parsed.file.body).toBe("Body\r\n");
  });

  it("an invalid id falls back to the filename's id", () => {
    const parsed = parseDocFile(
      "---\nid: not-a-ulid\ntitle: T\nkind: text\nparent: manuscript\n---\n",
      ID,
    );
    expect(parsed.file.meta.id).toBe(ID);
  });

  it("a closing fence must start a line", () => {
    const parsed = parseDocFile(
      `---\nid: ${ID}\ntitle: ends with ---\nkind: text\nparent: manuscript\n---\n\nX\n`,
      ID,
    );
    expect(parsed.file.meta.title).toBe("ends with ---");
    expect(parsed.file.body).toBe("X\n");
  });
});
