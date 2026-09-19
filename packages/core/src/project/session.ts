/**
 * A project open for editing. Every write goes through here so that:
 *
 * - writes to the same file are serialised (a per-file queue);
 * - only the changed document's file is written (renames, moves and trash
 *   touch one file each; ADR 0002);
 * - nothing is ever silently overwritten: before saving a body, the file on
 *   disk is compared with what Sheaf last read or wrote. If something else
 *   changed it, the editor's version is saved as a sibling "conflict copy"
 *   and the disk version is adopted.
 */
import { newId as defaultNewId } from "../ids";
import { keysBetween } from "../order";
import { parseDocFile, serializeDocFile, type DocFile } from "../format/docfile";
import { DOCS_DIR, PROJECT_FILE, docPath } from "../format/layout";
import { newProjectFile, serializeProjectFile, type ProjectFile } from "../format/project-file";
import { isRootId, type DocKind, type DocMeta, type RootId } from "../format/types";
import type { FileStat, ProjectFs } from "./fs";
import type { IndexStore } from "./index-store";
import {
  fileIdFromName,
  openProject,
  type LoadedDoc,
  type OpenOptions,
  type OpenedProject,
} from "./open";
import { buildTree, childrenOf, flatten, isWithin, rootOf, type ProjectTree } from "./tree";

export interface SessionLabels {
  untitled: string;
  newFolder: string;
  conflictCopy: (title: string) => string;
}

export interface SessionOptions {
  labels: SessionLabels;
  now?: () => Date;
  newId?: () => string;
}

export interface SessionSnapshot {
  revision: number;
  project: ProjectFile;
  tree: ProjectTree;
  docs: ReadonlyMap<string, LoadedDoc>;
  conflicts: readonly LoadedDoc[];
}

export type SaveResult =
  | { status: "saved" }
  /** The file changed elsewhere: our text is now `copyId`; `diskBody` is what the file holds. */
  | { status: "conflict"; copyId: string; diskBody: string };

export type DropPosition = "before" | "after" | "into";

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code: "unknown-document" | "invalid-move" | "exists",
  ) {
    super(message);
    this.name = "SessionError";
  }
}

interface Known {
  stat: FileStat;
  text: string;
}

export class ProjectSession {
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly queues = new Map<string, Promise<unknown>>();
  /** What Sheaf last read or wrote at each path; the basis for conflict detection. */
  private readonly known = new Map<string, Known>();
  /** Paths found changed by someone else during a metadata write; the next body save must not overwrite. */
  private readonly changedElsewhere = new Set<string>();
  private readonly now: () => Date;
  private readonly makeId: () => string;

  private constructor(
    private readonly fs: ProjectFs,
    private readonly index: IndexStore,
    private state: OpenedProject,
    private readonly options: SessionOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.makeId = options.newId ?? (() => defaultNewId(this.now().getTime()));
  }

  static async open(
    fs: ProjectFs,
    index: IndexStore,
    openOptions: OpenOptions,
    options: SessionOptions,
  ): Promise<ProjectSession> {
    const opened = await openProject(fs, index, openOptions);
    return new ProjectSession(fs, index, opened, options);
  }

  /** Writes a new, empty project (with one document) into an empty folder. */
  static async createProject(
    fs: ProjectFs,
    params: {
      title: string;
      roots: Record<RootId, string>;
      firstDocumentTitle: string;
      now: Date;
      newId?: () => string;
    },
  ): Promise<ProjectFile> {
    if ((await fs.readText(PROJECT_FILE)) !== null) {
      throw new SessionError("There is already a project in this folder.", "exists");
    }
    const project = newProjectFile(params.title, params.roots, params.now);
    await fs.mkdir(DOCS_DIR);
    const id = params.newId?.() ?? defaultNewId(params.now.getTime());
    const stamp = params.now.toISOString();
    const [order] = keysBetween(null, null, 1);
    await fs.writeTextAtomic(
      docPath(id),
      serializeDocFile({
        meta: {
          id,
          title: params.firstDocumentTitle,
          kind: "text",
          parent: "manuscript",
          order: order as string,
          created: stamp,
          modified: stamp,
          synopsis: "",
          trashedFrom: null,
        },
        extra: {},
        body: "",
      }),
    );
    // project.json last: until it exists, the folder isn't a project.
    await fs.writeTextAtomic(PROJECT_FILE, serializeProjectFile(project));
    return project;
  }

  // ------------------------------------------------------------ observing

  snapshot(): SessionSnapshot {
    return {
      revision: this.revision,
      project: this.state.project,
      tree: this.state.tree,
      docs: this.state.docs,
      conflicts: this.state.conflicts,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.state.tree = buildTree([...this.state.docs.values()].map((d) => d.meta));
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  get scan(): OpenedProject["scan"] {
    return this.state.scan;
  }

  // -------------------------------------------------------------- plumbing

  private enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(path) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      path,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /** Resolves once every queued write has finished. */
  async flush(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  async close(): Promise<void> {
    await this.flush();
    await this.index.close().catch(() => undefined);
    this.listeners.clear();
  }

  private doc(id: string): LoadedDoc {
    const doc = this.state.docs.get(id);
    if (!doc) throw new SessionError(`Unknown document ${id}`, "unknown-document");
    return doc;
  }

  private async write(path: string, file: DocFile): Promise<void> {
    const text = serializeDocFile(file);
    const stat = await this.fs.writeTextAtomic(path, text);
    this.known.set(path, { stat, text });
    this.state.docs.set(file.meta.id, {
      path,
      meta: file.meta,
      extra: file.extra,
      problems: [],
      stat,
    });
    this.index
      .apply({
        upsert: [
          {
            path,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            meta: file.meta,
            extra: file.extra,
            problems: [],
          },
        ],
      })
      .catch(() => undefined);
  }

  /** The disk text, if someone other than Sheaf changed the file since Sheaf last touched it. */
  private async changedOnDisk(path: string): Promise<{ text: string; stat: FileStat } | null> {
    const known = this.known.get(path);
    const stat = await this.fs.stat(path);
    if (!known || !stat) return null;
    if (stat.size === known.stat.size && stat.mtimeMs === known.stat.mtimeMs) return null;
    const text = await this.fs.readText(path);
    if (text === null) return null;
    if (text === known.text) {
      this.known.set(path, { stat, text }); // touched (e.g. by a sync client), not changed
      return null;
    }
    return { text, stat };
  }

  private nextSiblingOrder(id: string): string | null {
    const parent = this.state.tree.displayParent.get(id) ?? "manuscript";
    const siblings = childrenOf(this.state.tree, parent);
    const i = siblings.findIndex((n) => n.id === id);
    return siblings[i + 1]?.meta.order ?? null;
  }

  // ---------------------------------------------------------------- reading

  /** Reads a document's current file from disk. */
  readDocument(id: string): Promise<DocFile> {
    const { path } = this.doc(id);
    return this.enqueue(path, async () => {
      const doc = this.doc(id);
      const text = await this.fs.readText(path);
      const stat = await this.fs.stat(path);
      if (text === null || stat === null) return { meta: doc.meta, extra: doc.extra, body: "" };
      this.known.set(path, { stat, text });
      this.changedElsewhere.delete(path);
      const { file, problems } = parseDocFile(
        text,
        fileIdFromName(path.slice(DOCS_DIR.length + 1)),
      );
      file.meta.id = id;
      if (stat.size !== doc.stat.size || stat.mtimeMs !== doc.stat.mtimeMs) {
        this.state.docs.set(id, { path, meta: file.meta, extra: file.extra, problems, stat });
        this.changed();
      }
      return file;
    });
  }

  // ---------------------------------------------------------------- writing

  /** Saves a document's body. Never overwrites a change made elsewhere. */
  saveBody(id: string, body: string): Promise<SaveResult> {
    const { path } = this.doc(id);
    return this.enqueue(path, async () => {
      const doc = this.doc(id);
      const elsewhere = await this.changedOnDisk(path);
      if (elsewhere || this.changedElsewhere.has(path)) {
        const disk = elsewhere ?? {
          text: (await this.fs.readText(path)) ?? "",
          stat: (await this.fs.stat(path)) ?? doc.stat,
        };
        return this.keepBoth(id, body, disk);
      }
      await this.write(path, {
        meta: { ...doc.meta, modified: this.now().toISOString() },
        extra: doc.extra,
        body,
      });
      return { status: "saved" as const };
    });
  }

  private async keepBoth(
    id: string,
    ourBody: string,
    disk: { text: string; stat: FileStat },
  ): Promise<SaveResult> {
    const doc = this.doc(id);
    const stamp = this.now().toISOString();
    const copyId = this.makeId();
    const [order] = keysBetween(doc.meta.order || null, this.nextSiblingOrder(id), 1);
    await this.write(docPath(copyId), {
      meta: {
        ...doc.meta,
        id: copyId,
        title: this.options.labels.conflictCopy(doc.meta.title),
        order: order as string,
        created: stamp,
        modified: stamp,
        trashedFrom: null,
      },
      extra: doc.extra,
      body: ourBody,
    });

    const { file, problems } = parseDocFile(disk.text, id);
    file.meta.id = id;
    this.known.set(doc.path, { stat: disk.stat, text: disk.text });
    this.changedElsewhere.delete(doc.path);
    this.state.docs.set(id, {
      path: doc.path,
      meta: file.meta,
      extra: file.extra,
      problems,
      stat: disk.stat,
    });
    this.changed();
    return { status: "conflict", copyId, diskBody: file.body };
  }

  /** Read-modify-write of one document's metadata. The body on disk is kept as-is. */
  private updateMeta(id: string, patch: (meta: DocMeta) => DocMeta): Promise<void> {
    const { path } = this.doc(id);
    return this.enqueue(path, async () => {
      const doc = this.doc(id);
      if (await this.changedOnDisk(path)) this.changedElsewhere.add(path);
      const text = await this.fs.readText(path);
      let file: DocFile = { meta: doc.meta, extra: doc.extra, body: "" };
      if (text !== null) {
        const parsed = parseDocFile(text, id).file;
        file = { meta: { ...parsed.meta, id }, extra: parsed.extra, body: parsed.body };
      }
      await this.write(path, { ...file, meta: { ...patch(file.meta), id } });
    });
  }

  async createDocument(params: {
    kind: DocKind;
    parent: string;
    after?: string | null;
    title?: string;
  }): Promise<string> {
    const { kind, parent } = params;
    if (!isRootId(parent) && !this.state.docs.has(parent)) {
      throw new SessionError(`Unknown parent ${parent}`, "unknown-document");
    }
    const siblings = childrenOf(this.state.tree, parent);
    let prev = siblings[siblings.length - 1] ?? null;
    let next = null;
    if (params.after) {
      const i = siblings.findIndex((n) => n.id === params.after);
      if (i >= 0) {
        prev = siblings[i] ?? null;
        next = siblings[i + 1] ?? null;
      }
    }
    const [order] = keysBetween(prev?.meta.order ?? null, next?.meta.order ?? null, 1);
    const id = this.makeId();
    const stamp = this.now().toISOString();
    const title =
      params.title ??
      (kind === "folder" ? this.options.labels.newFolder : this.options.labels.untitled);
    const inTrash = parent === "trash" || rootOf(this.state.tree, parent) === "trash";
    await this.enqueue(docPath(id), () =>
      this.write(docPath(id), {
        meta: {
          id,
          title,
          kind,
          parent,
          order: order as string,
          created: stamp,
          modified: stamp,
          synopsis: "",
          trashedFrom: inTrash ? "manuscript" : null,
        },
        extra: {},
        body: "",
      }),
    );
    this.changed();
    return id;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.updateMeta(id, (m) => ({ ...m, title }));
    this.changed();
  }

  async setSynopsis(id: string, synopsis: string): Promise<void> {
    await this.updateMeta(id, (m) => ({ ...m, synopsis }));
    this.changed();
  }

  /**
   * Moves documents next to or into `targetId` (a document or a root).
   * Descendants travel with their ancestors; relative order is preserved.
   */
  async move(ids: readonly string[], targetId: string, position: DropPosition): Promise<void> {
    const tree = this.state.tree;
    const selected = new Set(ids.filter((id) => this.state.docs.has(id)));
    // Only move the top-most selected items; their descendants come along.
    const moving = flatten(tree)
      .map((n) => n.id)
      .filter((id) => selected.has(id))
      .filter((id) => {
        let p = tree.displayParent.get(id);
        while (p !== undefined && !isRootId(p)) {
          if (selected.has(p)) return false;
          p = tree.displayParent.get(p);
        }
        return true;
      });
    if (moving.length === 0) return;

    let parent: string;
    let before: string | null;
    if (position === "into") {
      parent = targetId;
      before = null;
    } else {
      if (isRootId(targetId))
        throw new SessionError("Can't place items beside a root.", "invalid-move");
      parent = tree.displayParent.get(targetId) ?? "manuscript";
      if (position === "before") before = targetId;
      else {
        const siblings = childrenOf(tree, parent).filter((n) => !selected.has(n.id));
        const i = siblings.findIndex((n) => n.id === targetId);
        before = siblings[i + 1]?.id ?? null;
      }
    }
    if (!isRootId(parent) && !this.state.docs.has(parent)) {
      throw new SessionError(`Unknown target ${parent}`, "unknown-document");
    }
    if (moving.some((id) => isWithin(tree, parent, id))) {
      throw new SessionError("Can't move an item into itself.", "invalid-move");
    }

    const siblings = childrenOf(tree, parent).filter((n) => !selected.has(n.id));
    const index =
      before === null
        ? siblings.length
        : Math.max(
            0,
            siblings.findIndex((n) => n.id === before),
          );
    const keys = keysBetween(
      siblings[index - 1]?.meta.order ?? null,
      siblings[index]?.meta.order ?? null,
      moving.length,
    );
    const toTrash = parent === "trash" || rootOf(tree, parent) === "trash";

    await Promise.all(
      moving.map((id, i) => {
        const from = tree.displayParent.get(id) ?? "manuscript";
        const fromTrash = rootOf(tree, id) === "trash";
        return this.updateMeta(id, (m) => ({
          ...m,
          parent,
          order: keys[i] as string,
          trashedFrom: toTrash ? (fromTrash ? m.trashedFrom : from) : null,
        }));
      }),
    );
    this.changed();
  }

  /** Moves items to the Trash. Recoverable: nothing is deleted. */
  trash(ids: readonly string[]): Promise<void> {
    return this.move(ids, "trash", "into");
  }

  /** Puts trashed items back where they came from (or the Manuscript). */
  async restore(ids: readonly string[]): Promise<void> {
    const tree = this.state.tree;
    for (const id of ids) {
      const doc = this.state.docs.get(id);
      if (!doc || rootOf(tree, id) !== "trash") continue;
      const origin = doc.meta.trashedFrom;
      const usable =
        origin !== null &&
        (isRootId(origin)
          ? origin !== "trash"
          : this.state.docs.has(origin) && rootOf(this.state.tree, origin) !== "trash");
      await this.move([id], usable ? (origin as string) : "manuscript", "into");
    }
  }

  /** Turns a sync-conflict copy into an ordinary document next to its original. */
  async keepConflictAsDocument(path: string): Promise<string> {
    const conflict = this.state.conflicts.find((c) => c.path === path);
    if (!conflict) throw new SessionError(`No conflict copy at ${path}`, "unknown-document");
    const text = (await this.fs.readText(path)) ?? "";
    const { file } = parseDocFile(text, conflict.meta.id);
    const id = this.makeId();
    const original = this.state.docs.get(conflict.meta.id);
    const [order] = original
      ? keysBetween(original.meta.order || null, this.nextSiblingOrder(original.meta.id), 1)
      : keysBetween(null, null, 1);
    const target = docPath(id);
    // Rename first (never destructive), then give the file its own identity.
    await this.fs.rename(path, target);
    await this.enqueue(target, () =>
      this.write(target, {
        meta: {
          ...file.meta,
          id,
          title: this.options.labels.conflictCopy(file.meta.title),
          order: order as string,
        },
        extra: file.extra,
        body: file.body,
      }),
    );
    this.state.conflicts = this.state.conflicts.filter((c) => c.path !== path);
    this.changed();
    return id;
  }
}
