/**
 * `project.json`: the marker that makes a folder a Sheaf project, and the one
 * place the format version lives (ADR 0002).
 */
import { newId } from "../ids";
import { ROOT_IDS, type RootId } from "./types";

export const FORMAT_ID = "sheaf-project";
/** Bump only together with a migration in `project/migrations.ts`. */
export const CURRENT_FORMAT_VERSION = 1;

/** Writing goals, kept with the project so they travel with it. */
export interface ProjectSettings {
  /** What target numbers count: words (default) or characters. */
  countUnit: "words" | "characters";
  /** Goal for the whole manuscript. */
  manuscriptTarget: number | null;
  /** Date to finish by, as YYYY-MM-DD. */
  deadline: string | null;
  /** Daily writing goal. */
  sessionTarget: number | null;

  // ---- language and checking (brief §7)

  /** The manuscript's main language; paragraphs may still differ. */
  language: string | null;
  /** Which English Harper checks against. */
  dialect: "american" | "british" | "canadian" | "australian";
  /** Master switch for spelling and grammar. Chinese is off regardless. */
  checkGrammar: boolean;
  /**
   * A LanguageTool server the writer configured and confirmed. `null` — the
   * default — means Sheaf never contacts anything: local engines or nothing.
   */
  languageToolEndpoint: string | null;
  /** Words the writer added for this project, in the order they were added. */
  dictionary: string[];
  /** `kind|text` pairs the writer told Sheaf to stop flagging. */
  ignored: string[];
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  countUnit: "words",
  manuscriptTarget: null,
  deadline: null,
  sessionTarget: null,
  language: null,
  dialect: "american",
  checkGrammar: true,
  languageToolEndpoint: null,
  dictionary: [],
  ignored: [],
};

export interface ProjectFile {
  formatVersion: number;
  id: string;
  title: string;
  created: string;
  /** Display names of the three root containers (user-renamable). */
  roots: Record<RootId, string>;
  settings: ProjectSettings;
  /** Keys Sheaf doesn't know, preserved on rewrite. */
  extra: Record<string, unknown>;
}

export type ProjectFileError = "not-json" | "not-a-project" | "missing-fields";

export type ParsedProjectFile =
  { ok: true; project: ProjectFile } | { ok: false; error: ProjectFileError };

const KNOWN = new Set(["format", "formatVersion", "id", "title", "created", "roots", "settings"]);

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((w): w is string => typeof w === "string" && w.trim() !== ""))]
    : [];

const positiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function parseSettings(raw: unknown): ProjectSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return settings;
  const fields = raw as Record<string, unknown>;
  if (fields["countUnit"] === "characters") settings.countUnit = "characters";
  settings.manuscriptTarget = positiveInt(fields["manuscriptTarget"]);
  settings.sessionTarget = positiveInt(fields["sessionTarget"]);
  const deadline = fields["deadline"];
  settings.deadline =
    typeof deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;

  const language = fields["language"];
  settings.language =
    typeof language === "string" && language.trim() !== "" ? language.trim() : null;
  const dialect = fields["dialect"];
  if (dialect === "british" || dialect === "canadian" || dialect === "australian") {
    settings.dialect = dialect;
  }
  if (fields["checkGrammar"] === false) settings.checkGrammar = false;
  // Plain http only, and only an address the writer put here: Sheaf talks to
  // a LanguageTool server you run, never to a cloud service (brief §7, and
  // docs/adr/0003-language-layer.md). The shell enforces the same rule.
  const endpoint = fields["languageToolEndpoint"];
  settings.languageToolEndpoint =
    typeof endpoint === "string" && /^http:\/\/\S+$/.test(endpoint.trim()) ? endpoint.trim() : null;
  settings.dictionary = stringList(fields["dictionary"]);
  settings.ignored = stringList(fields["ignored"]);
  return settings;
}

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
      settings: parseSettings(fields["settings"]),
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
    settings: project.settings,
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
    settings: { ...DEFAULT_SETTINGS },
    extra: {},
  };
}
