/**
 * `project.json`: the marker that makes a folder a Sheaf project, and the one
 * place the format version lives (ADR 0002).
 */
import { newId } from "../ids";
import { ROOT_IDS, type RootId } from "./types";

export const FORMAT_ID = "sheaf-project";
/** Bump only together with a migration in `project/migrations.ts`. */
export const CURRENT_FORMAT_VERSION = 1;

export interface ProjectFile {
  formatVersion: number;
  id: string;
  title: string;
  created: string;
  /** Display names of the three root containers (user-renamable). */
  roots: Record<RootId, string>;
  /** Keys Sheaf doesn't know, preserved on rewrite. */
  extra: Record<string, unknown>;
}

export type ProjectFileError = "not-json" | "not-a-project" | "missing-fields";

export type ParsedProjectFile =
  { ok: true; project: ProjectFile } | { ok: false; error: ProjectFileError };

const KNOWN = new Set(["format", "formatVersion", "id", "title", "created", "roots"]);

export function parseProjectFile(
  text: string,
  defaultRoots: Record<RootId, string>,
): ParsedProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "not-a-project" };
  }
  const fields = data as Record<string, unknown>;
  if (fields["format"] !== FORMAT_ID) return { ok: false, error: "not-a-project" };

  const version = fields["formatVersion"];
  const id = fields["id"];
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    typeof id !== "string" ||
    id === ""
  ) {
    return { ok: false, error: "missing-fields" };
  }

  const roots = { ...defaultRoots };
  const rawRoots = fields["roots"];
  if (typeof rawRoots === "object" && rawRoots !== null) {
    for (const root of ROOT_IDS) {
      const name = (rawRoots as Record<string, unknown>)[root];
      if (typeof name === "string" && name.trim() !== "") roots[root] = name;
    }
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) if (!KNOWN.has(key)) extra[key] = value;

  return {
    ok: true,
    project: {
      formatVersion: version,
      id,
      title: typeof fields["title"] === "string" ? fields["title"] : "",
      created: typeof fields["created"] === "string" ? fields["created"] : "",
      roots,
      extra,
    },
  };
}

export function serializeProjectFile(project: ProjectFile): string {
  const ordered: Record<string, unknown> = {
    format: FORMAT_ID,
    formatVersion: project.formatVersion,
    id: project.id,
    title: project.title,
    created: project.created,
    roots: project.roots,
    ...Object.fromEntries(Object.entries(project.extra).filter(([k]) => !KNOWN.has(k))),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function newProjectFile(
  title: string,
  roots: Record<RootId, string>,
  now: Date,
): ProjectFile {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    id: newId(now.getTime()),
    title,
    created: now.toISOString(),
    roots: { ...roots },
    extra: {},
  };
}
