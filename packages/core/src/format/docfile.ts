/**
 * A document file: YAML frontmatter + Markdown body (ADR 0002).
 *
 * Reading never throws and never loses the body: files with missing or broken
 * frontmatter still open, with defaults and a recorded problem. Unknown
 * frontmatter keys are carried through untouched, so files written by a newer
 * Sheaf survive a round trip through an older one.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { isValidId } from "../ids";
import type { DocKind, DocMeta, DocProblem } from "./types";

export interface DocFile {
  meta: DocMeta;
  /** Frontmatter keys Sheaf doesn't know, in their original order. */
  extra: Record<string, unknown>;
  /** Markdown body, exactly as stored. */
  body: string;
}

export interface ParsedDocFile {
  file: DocFile;
  problems: DocProblem[];
}

const KNOWN_KEYS = new Set([
  "id",
  "title",
  "kind",
  "parent",
  "order",
  "created",
  "modified",
  "synopsis",
  "trashedFrom",
  "target",
]);

const BOM = String.fromCharCode(0xfeff);
// The closing `---` must start a line; the YAML block may be empty.
const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

function titleFromBody(body: string): string | null {
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body);
  return heading?.[1]?.trim() || null;
}

function defaults(fileId: string, body: string): DocMeta {
  return {
    id: fileId,
    title: titleFromBody(body) ?? fileId,
    kind: "text",
    parent: "manuscript",
    order: "",
    created: "",
    modified: "",
    synopsis: "",
    trashedFrom: null,
    target: null,
  };
}

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;

/**
 * Parses a document file. `fileId` is the id implied by the filename
 * (`docs/<id>.md`); it is used when the frontmatter has no usable id.
 */
export function parseDocFile(text: string, fileId: string): ParsedDocFile {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const match = FRONTMATTER.exec(source);
  if (!match) {
    return {
      file: { meta: defaults(fileId, source), extra: {}, body: source },
      problems: ["no-frontmatter"],
    };
  }

  let body = source.slice(match[0].length);
  body = body.replace(/^\r?\n/, ""); // the blank line Sheaf writes after the frontmatter

  let data: unknown;
  try {
    data = parseYaml(match[1] ?? "", { maxAliasCount: 50 });
  } catch {
    data = undefined;
  }
  if (data === null || data === undefined) data = match[1]?.trim() === "" ? {} : undefined;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      file: { meta: defaults(fileId, body), extra: {}, body },
      problems: ["invalid-frontmatter"],
    };
  }

  const fields = data as Record<string, unknown>;
  const meta = defaults(fileId, body);
  let missing = false;

  const id = str(fields["id"]);
  if (id !== null && isValidId(id)) meta.id = id;
  else missing = true;

  const title = str(fields["title"]);
  if (title !== null) meta.title = title;
  else missing = true;

  const kind = fields["kind"];
  if (kind === "text" || kind === "folder") meta.kind = kind as DocKind;
  else missing = true;

  const parent = str(fields["parent"]);
  if (parent !== null && parent.trim() !== "") meta.parent = parent.trim();
  else missing = true;

  meta.order = str(fields["order"]) ?? "";
  meta.created = str(fields["created"]) ?? "";
  meta.modified = str(fields["modified"]) ?? "";
  meta.synopsis = str(fields["synopsis"]) ?? "";
  const trashedFrom = str(fields["trashedFrom"]);
  meta.trashedFrom = trashedFrom && trashedFrom.trim() !== "" ? trashedFrom : null;
  const target = Number(fields["target"]);
  meta.target = Number.isInteger(target) && target > 0 ? target : null;

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  return { file: { meta, extra, body }, problems: missing ? ["missing-fields"] : [] };
}

/** Serialises a document file with a stable key order and `\n` line endings. */
export function serializeDocFile(file: DocFile): string {
  const { meta, extra, body } = file;
  const fields: Record<string, unknown> = {
    id: meta.id,
    title: meta.title,
    kind: meta.kind,
    parent: meta.parent,
    order: meta.order,
    created: meta.created,
    modified: meta.modified,
    synopsis: meta.synopsis,
  };
  if (meta.trashedFrom !== null) fields["trashedFrom"] = meta.trashedFrom;
  if (meta.target !== null) fields["target"] = meta.target;
  for (const [key, value] of Object.entries(extra)) {
    if (!KNOWN_KEYS.has(key)) fields[key] = value;
  }

  const yaml = stringifyYaml(fields, { lineWidth: 0, minContentWidth: 0 }).replace(/\n+$/, "");
  const normalizedBody = body.replace(/\r\n?/g, "\n");
  const tail = normalizedBody === "" ? "" : `\n${normalizedBody.replace(/\n*$/, "\n")}`;
  return `---\n${yaml}\n---\n${tail}`;
}
