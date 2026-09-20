/**
 * Opening a project: read `project.json`, migrate if needed, scan `docs/`,
 * reconcile with the cache index (re-reading only files whose size or mtime
 * changed), detect sync-conflict duplicates, and build the binder tree.
 */
import { parseDocFile } from "../format/docfile";
import { DOCS_DIR, PROJECT_FILE, docPath, isDocFileName, isTempFileName } from "../format/layout";
import { parseProjectFile, type ProjectFile } from "../format/project-file";
import { countText, type TextCounts } from "../text/count";
import { plainTextOf } from "../text/paragraphs";
import type { DocMeta, DocProblem, RootId } from "../format/types";
import type { FileStat, ProjectFs } from "./fs";
import { INDEX_SCHEMA_VERSION, type IndexStore, type IndexedFile } from "./index-store";
import { migrateProject, type Migration } from "./migrations";
import { buildTree, type ProjectTree } from "./tree";

export interface LoadedDoc {
  path: string;
  meta: DocMeta;
  extra: Record<string, unknown>;
  problems: DocProblem[];
  /** Size and mtime when last read or written by Sheaf. */
  stat: FileStat;
  counts: TextCounts;
}

export interface OpenedProject {
  project: ProjectFile;
  /** One entry per document id: the canonical file for that id. */
  docs: Map<string, LoadedDoc>;
  /** Extra files claiming an id that's already taken (sync-conflict copies). */
  conflicts: LoadedDoc[];
  tree: ProjectTree;
  scan: { files: number; reread: number; cacheRebuilt: boolean };
}

export type OpenErrorCode = "not-a-project" | "newer-format" | "unreadable";

export class ProjectOpenError extends Error {
  constructor(
    message: string,
    readonly code: OpenErrorCode,
  ) {
    super(message);
    this.name = "ProjectOpenError";
  }
}

export interface OpenOptions {
  /** Identifies this folder for the cache (absolute path or handle key). */
  rootKey: string;
  /** Display names used when project.json has none. */
  defaultRoots: Record<RootId, string>;
  now?: () => Date;
  migrations?: readonly Migration[];
  targetVersion?: number;
}

export function fileIdFromName(name: string): string {
  return name.replace(/\.md$/i, "");
}

export async function readProjectFile(
  fs: ProjectFs,
  defaultRoots: Record<RootId, string>,
): Promise<ProjectFile> {
  const text = await fs.readText(PROJECT_FILE);
  if (text === null)
    throw new ProjectOpenError("This folder isn't a Sheaf project.", "not-a-project");
  const parsed = parseProjectFile(text, defaultRoots);
  if (!parsed.ok) {
    throw new ProjectOpenError(
      parsed.error === "not-a-project"
        ? "This folder isn't a Sheaf project."
        : "project.json can't be read.",
      parsed.error === "not-a-project" ? "not-a-project" : "unreadable",
    );
  }
  return parsed.project;
}

export async function openProject(
  fs: ProjectFs,
  index: IndexStore,
  options: OpenOptions,
): Promise<OpenedProject> {
  const now = options.now ?? (() => new Date());
  let project = await readProjectFile(fs, options.defaultRoots);
  try {
    project = await migrateProject(fs, project, {
      now: now(),
      ...(options.migrations ? { migrations: options.migrations } : {}),
      ...(options.targetVersion !== undefined ? { targetVersion: options.targetVersion } : {}),
    });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === "newer-format") {
      throw new ProjectOpenError(error.message, "newer-format");
    }
    throw error;
  }

  // ---- cache
  let cached = new Map<string, IndexedFile>();
  let cacheRebuilt = false;
  try {
    const snapshot = await index.load();
    const valid =
      snapshot.meta !== null &&
      snapshot.meta.schemaVersion === INDEX_SCHEMA_VERSION &&
      snapshot.meta.projectId === project.id &&
      snapshot.meta.rootKey === options.rootKey;
    if (valid) cached = new Map(snapshot.files.map((f) => [f.path, f]));
    else {
      await index.reset({
        schemaVersion: INDEX_SCHEMA_VERSION,
        projectId: project.id,
        rootKey: options.rootKey,
      });
      cacheRebuilt = true;
    }
  } catch {
    cacheRebuilt = true;
  }

  // ---- scan
  await fs.mkdir(DOCS_DIR);
  const entries = await fs.list(DOCS_DIR);
  const loaded: LoadedDoc[] = [];
  const upsert: IndexedFile[] = [];
  let reread = 0;
  for (const entry of entries) {
    if (entry.isDir) continue;
    const path = `${DOCS_DIR}/${entry.name}`;
    if (isTempFileName(entry.name)) {
      await fs.removeTemp(path).catch(() => undefined);
      continue;
    }
    if (!isDocFileName(entry.name)) continue;

    const hit = cached.get(path);
    if (hit && hit.size === entry.size && hit.mtimeMs === entry.mtimeMs) {
      loaded.push({
        path,
        meta: hit.meta,
        extra: hit.extra,
        problems: hit.problems,
        stat: { size: hit.size, mtimeMs: hit.mtimeMs },
        counts: hit.counts,
      });
      continue;
    }
    const text = await fs.readText(path);
    if (text === null) continue; // vanished between list and read
    reread++;
    const { file, problems } = parseDocFile(text, fileIdFromName(entry.name));
    const plain = plainTextOf(file.body);
    const counts = countText(plain);
    const doc: LoadedDoc = {
      path,
      meta: file.meta,
      extra: file.extra,
      problems,
      stat: { size: entry.size, mtimeMs: entry.mtimeMs },
      counts,
    };
    loaded.push(doc);
    upsert.push({
      path,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      meta: file.meta,
      extra: file.extra,
      problems,
      counts,
      text: plain,
    });
  }

  const present = new Set(loaded.map((d) => d.path));
  const remove = [...cached.keys()].filter((p) => !present.has(p));
  try {
    await index.apply({ upsert, remove });
  } catch {
    // The cache is optional; the next open rescans.
  }

  // ---- duplicates: the file named after the id wins; others are conflict copies
  const byId = new Map<string, LoadedDoc[]>();
  for (const doc of loaded) {
    const list = byId.get(doc.meta.id) ?? [];
    list.push(doc);
    byId.set(doc.meta.id, list);
  }
  const docs = new Map<string, LoadedDoc>();
  const conflicts: LoadedDoc[] = [];
  for (const [id, list] of byId) {
    list.sort((a, b) => {
      const ac = a.path === docPath(id) ? 0 : 1;
      const bc = b.path === docPath(id) ? 0 : 1;
      return ac - bc || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    });
    docs.set(id, list[0] as LoadedDoc);
    conflicts.push(...list.slice(1));
  }

  return {
    project,
    docs,
    conflicts,
    tree: buildTree([...docs.values()].map((d) => d.meta)),
    scan: { files: loaded.length, reread, cacheRebuilt },
  };
}
