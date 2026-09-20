import { beforeEach, describe, expect, it } from "vitest";
import { parseDocFile, serializeDocFile } from "../format/docfile";
import { docPath, PROJECT_FILE } from "../format/layout";
import { parseProjectFile, serializeProjectFile } from "../format/project-file";
import type { RootId } from "../format/types";
import { MemoryFs } from "./fs";
import { MemoryIndexStore } from "./index-store";
import type { Migration } from "./migrations";
import { ProjectOpenError } from "./open";
import { ProjectSession, SessionError } from "./session";
import { flatten, rootOf } from "./tree";

const ROOTS: Record<RootId, string> = {
  manuscript: "Manuscript",
  research: "Research",
  trash: "Trash",
};
const labels = {
  untitled: "Untitled",
  newFolder: "New Folder",
  conflictCopy: (title: string) => `${title} (conflict copy)`,
  snapshotCopy: (title: string) => `${title} (snapshot)`,
};

let clock = Date.parse("2026-09-18T10:00:00.000Z");
const now = (): Date => new Date((clock += 1000));

async function openSession(fs: MemoryFs, index = new MemoryIndexStore()): Promise<ProjectSession> {
  return ProjectSession.open(
    fs,
    index,
    { rootKey: "memory", defaultRoots: ROOTS, now },
    { labels, now },
  );
}

async function newProject(): Promise<{ fs: MemoryFs; session: ProjectSession }> {
  const fs = new MemoryFs(() => clock);
  await ProjectSession.createProject(fs, {
    title: "Novel",
    roots: ROOTS,
    firstDocumentTitle: "Chapter 1",
    now: now(),
  });
  return { fs, session: await openSession(fs) };
}

const titles = (s: ProjectSession, root: RootId = "manuscript"): string[] =>
  flatten(s.snapshot().tree, root).map((n) => n.meta.title);

/** Moves the test clock forward, e.g. to the next writing day. */
const advance = (ms: number): void => {
  clock += ms;
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("creating and opening", () => {
  it("creates a project with one document ready to type into", async () => {
    const { fs, session } = await newProject();
    expect(session.snapshot().project.title).toBe("Novel");
    expect(titles(session)).toEqual(["Chapter 1"]);
    expect((await fs.list("docs")).length).toBe(1);
  });

  it("refuses to create over an existing project", async () => {
    const { fs } = await newProject();
    await expect(
      ProjectSession.createProject(fs, {
        title: "X",
        roots: ROOTS,
        firstDocumentTitle: "Y",
        now: now(),
      }),
    ).rejects.toBeInstanceOf(SessionError);
  });

  it("refuses a folder that isn't a project", async () => {
    await expect(openSession(new MemoryFs())).rejects.toMatchObject({ code: "not-a-project" });
  });

  it("refuses a project from a newer Sheaf", async () => {
    const { fs } = await newProject();
    const project = parseProjectFile((await fs.readText(PROJECT_FILE)) ?? "", ROOTS);
    if (!project.ok) throw new Error("setup");
    fs.externalWrite(PROJECT_FILE, serializeProjectFile({ ...project.project, formatVersion: 99 }));
    await expect(openSession(fs)).rejects.toBeInstanceOf(ProjectOpenError);
  });
});

describe("the writing loop: edit, save, reopen", () => {
  let fs: MemoryFs;
  let session: ProjectSession;
  beforeEach(async () => ({ fs, session } = await newProject()));

  it("persists a body across sessions", async () => {
    const [first] = flatten(session.snapshot().tree);
    const id = first?.id as string;
    await session.readDocument(id);
    expect(await session.saveBody(id, "She arrived at dawn.\n")).toEqual({ status: "saved" });

    const reopened = await openSession(fs);
    expect((await reopened.readDocument(id)).body).toBe("She arrived at dawn.\n");
  });

  it("keeps 5,000 words across 20 documents with nothing flushed on exit", async () => {
    const words = (n: number, seed: number): string =>
      Array.from({ length: n }, (_, i) => `word${seed}_${i}`).join(" ");
    const ids: string[] = [];
    for (let i = 0; i < 20; i++)
      ids.push(
        await session.createDocument({ kind: "text", parent: "manuscript", title: `Scene ${i}` }),
      );
    for (const [i, id] of ids.entries()) {
      await session.readDocument(id);
      await session.saveBody(id, `${words(250, i)}\n`);
    }
    // No close(), no flush(): a force-quit right after the last save returned.
    const reopened = await openSession(fs);
    let total = 0;
    for (const [i, id] of ids.entries()) {
      const body = (await reopened.readDocument(id)).body;
      expect(body).toBe(`${words(250, i)}\n`);
      total += body.trim().split(/\s+/).length;
    }
    expect(total).toBe(5000);
    expect(titles(reopened).slice(1)).toEqual(ids.map((_, i) => `Scene ${i}`));
  });

  it("serialises rapid saves to the same document", async () => {
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await Promise.all(Array.from({ length: 25 }, (_, i) => session.saveBody(id, `version ${i}\n`)));
    expect((await (await openSession(fs)).readDocument(id)).body).toBe("version 24\n");
  });
});

describe("binder operations write one file each", () => {
  let fs: MemoryFs;
  let session: ProjectSession;
  beforeEach(async () => ({ fs, session } = await newProject()));

  it("creates documents and folders, in order, after a given sibling", async () => {
    const first = flatten(session.snapshot().tree)[0]?.id as string;
    const c = await session.createDocument({ kind: "text", parent: "manuscript", title: "C" });
    await session.createDocument({ kind: "text", parent: "manuscript", title: "B", after: first });
    const folder = await session.createDocument({ kind: "folder", parent: "manuscript" });
    await session.createDocument({ kind: "text", parent: folder, title: "Inside" });
    expect(titles(session)).toEqual(["Chapter 1", "B", "C", "New Folder", "Inside"]);
    expect(session.snapshot().docs.get(c)?.meta.kind).toBe("text");
  });

  it("renames by rewriting only the frontmatter", async () => {
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "Body stays.\n");
    await session.rename(id, "第一章");
    const file = parseDocFile((await fs.readText(docPath(id))) ?? "", id).file;
    expect(file.meta.title).toBe("第一章");
    expect(file.body).toBe("Body stays.\n");
  });

  it("moves before, after and into, touching only the moved files", async () => {
    const [a] = flatten(session.snapshot().tree).map((n) => n.id) as [string];
    const b = await session.createDocument({ kind: "text", parent: "manuscript", title: "B" });
    const c = await session.createDocument({ kind: "text", parent: "manuscript", title: "C" });
    const folder = await session.createDocument({
      kind: "folder",
      parent: "manuscript",
      title: "Part",
    });

    const before = new Map([...fs.files].map(([p, f]) => [p, f.mtimeMs]));
    await session.move([c], a, "before");
    const touched = [...fs.files].filter(([p, f]) => before.get(p) !== f.mtimeMs).map(([p]) => p);
    expect(touched).toEqual([docPath(c)]);
    expect(titles(session)).toEqual(["C", "Chapter 1", "B", "Part"]);

    await session.move([a, b], folder, "into");
    expect(titles(session)).toEqual(["C", "Part", "Chapter 1", "B"]);
    await session.move([c], b, "after");
    expect(titles(session)).toEqual(["Part", "Chapter 1", "B", "C"]);

    // …and it's all on disk.
    expect(titles(await openSession(fs))).toEqual(["Part", "Chapter 1", "B", "C"]);
  });

  it("moves a folder with its contents, and refuses to move it into itself", async () => {
    const folder = await session.createDocument({
      kind: "folder",
      parent: "manuscript",
      title: "Part",
    });
    const child = await session.createDocument({ kind: "text", parent: folder, title: "Child" });
    await expect(session.move([folder], child, "into")).rejects.toMatchObject({
      code: "invalid-move",
    });
    await session.move([folder, child], "research", "into");
    expect(titles(session, "research")).toEqual(["Part", "Child"]);
  });

  it("trashes recoverably and restores to the original place", async () => {
    const folder = await session.createDocument({
      kind: "folder",
      parent: "manuscript",
      title: "Part",
    });
    const scene = await session.createDocument({ kind: "text", parent: folder, title: "Scene" });
    await session.trash([scene]);
    expect(titles(session, "trash")).toEqual(["Scene"]);
    expect(rootOf(session.snapshot().tree, scene)).toBe("trash");
    expect(fs.files.has(docPath(scene))).toBe(true); // nothing deleted

    const reopened = await openSession(fs);
    await reopened.restore([scene]);
    expect(reopened.snapshot().tree.displayParent.get(scene)).toBe(folder);
  });

  it("restores to the manuscript when the original parent is gone too", async () => {
    const folder = await session.createDocument({
      kind: "folder",
      parent: "manuscript",
      title: "Part",
    });
    const scene = await session.createDocument({ kind: "text", parent: folder, title: "Scene" });
    await session.trash([scene]);
    await session.trash([folder]);
    await session.restore([scene]);
    expect(session.snapshot().tree.displayParent.get(scene)).toBe("manuscript");
  });
});

describe("never overwriting someone else's change", () => {
  it("keeps both versions when the file changed on disk during editing", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "Mine, first draft.\n");

    // Another device syncs a different version in.
    const theirs = parseDocFile((await fs.readText(docPath(id))) ?? "", id).file;
    fs.externalWrite(docPath(id), serializeDocFile({ ...theirs, body: "Theirs.\n" }));

    const result = await session.saveBody(id, "Mine, second draft.\n");
    expect(result).toMatchObject({ status: "conflict", diskBody: "Theirs.\n" });
    const copyId = (result as { copyId: string }).copyId;
    expect(parseDocFile((await fs.readText(docPath(copyId))) ?? "", copyId).file.body).toBe(
      "Mine, second draft.\n",
    );
    expect(parseDocFile((await fs.readText(docPath(id))) ?? "", id).file.body).toBe("Theirs.\n");
    expect(titles(session)).toEqual(["Chapter 1", "Chapter 1 (conflict copy)"]);
  });

  it("ignores a touch that didn't change the content", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    fs.externalWrite(docPath(id), (await fs.readText(docPath(id))) ?? "");
    expect(await session.saveBody(id, "Fine.\n")).toEqual({ status: "saved" });
  });

  it("notices an outside change picked up during a rename", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    const file = parseDocFile((await fs.readText(docPath(id))) ?? "", id).file;
    fs.externalWrite(docPath(id), serializeDocFile({ ...file, body: "Edited elsewhere.\n" }));
    await session.rename(id, "Renamed");
    const result = await session.saveBody(id, "Stale editor text.\n");
    expect(result).toMatchObject({ status: "conflict", diskBody: "Edited elsewhere.\n" });
  });
});

describe("damage and sync debris", () => {
  it("lists sync-conflict duplicates instead of hiding or overwriting them", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    const original = (await fs.readText(docPath(id))) ?? "";
    fs.externalWrite(
      `docs/${id} (conflicted copy).md`,
      original.replace(/\n$/, "\nOther device's text.\n"),
    );

    const reopened = await openSession(fs);
    expect(reopened.snapshot().conflicts.map((c) => c.path)).toEqual([
      `docs/${id} (conflicted copy).md`,
    ]);
    expect(reopened.snapshot().docs.get(id)?.path).toBe(docPath(id));

    const newId = await reopened.keepConflictAsDocument(`docs/${id} (conflicted copy).md`);
    expect(reopened.snapshot().conflicts).toEqual([]);
    expect(fs.files.has(docPath(newId))).toBe(true);
    expect(titles(reopened)).toContain("Chapter 1 (conflict copy)");
  });

  it("removes leftover temp files and opens files without frontmatter", async () => {
    const { fs } = await newProject();
    fs.externalWrite("docs/.01ABC.md.123.tmp", "half-writ");
    fs.externalWrite("docs/notes-from-elsewhere.md", "# Imported\n\nPlain Markdown.\n");
    const session = await openSession(fs);
    expect(fs.files.has("docs/.01ABC.md.123.tmp")).toBe(false);
    expect(titles(session)).toContain("Imported");
  });

  it("reads only changed files when the cache is warm", async () => {
    const { fs } = await newProject();
    const index = new MemoryIndexStore();
    const first = await openSession(fs, index);
    for (let i = 0; i < 5; i++) await first.createDocument({ kind: "text", parent: "manuscript" });
    const warm = await openSession(fs, index);
    expect(warm.scan).toMatchObject({ files: 6, reread: 0 });

    const id = flatten(warm.snapshot().tree)[2]?.id as string;
    const file = parseDocFile((await fs.readText(docPath(id))) ?? "", id).file;
    fs.externalWrite(
      docPath(id),
      serializeDocFile({ ...file, meta: { ...file.meta, title: "Changed" } }),
    );
    const again = await openSession(fs, index);
    expect(again.scan).toMatchObject({ files: 6, reread: 1 });
    expect(titles(again)).toContain("Changed");
  });
});

describe("snapshots", () => {
  const YESTERDAY = [
    "She climbed the stairs slowly.",
    "",
    "The paragraph about the lighthouse keeper's dog.",
    "",
    "Then she reached the top.",
  ].join("\n");
  const TODAY = ["She climbed the stairs slowly.", "", "Then she reached the top."].join("\n");

  /** The Phase 2 acceptance test: recover a paragraph deleted yesterday. */
  it("recovers a paragraph deleted yesterday", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;

    // Yesterday: write the scene.
    await session.readDocument(id);
    await session.saveBody(id, `${YESTERDAY}\n`);

    // Today: delete a paragraph and keep writing.
    advance(DAY);
    const today = await openSession(fs);
    await today.readDocument(id);
    await today.saveBody(id, `${TODAY}\n`);

    const snapshots = await today.listSnapshots(id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.kind).toBe("auto");

    // The lost paragraph is in the snapshot, and can be put back.
    const kept = await today.readSnapshot(snapshots[0]?.path as string);
    expect(kept.body).toContain("lighthouse keeper's dog");
    const restored = await today.restoreSnapshot(id, snapshots[0]?.path as string);
    expect(restored).toContain("lighthouse keeper's dog");
    expect((await today.readDocument(id)).body).toContain("lighthouse keeper's dog");

    // Restoring is itself undoable: today's version was kept first.
    const after = await today.listSnapshots(id);
    expect(after.map((s) => s.kind)).toContain("before-restore");
    expect((await today.readSnapshot(after[0]?.path as string)).body).not.toContain("dog");
  });

  it("doesn't snapshot on every save", async () => {
    const { session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    for (let i = 0; i < 10; i++) {
      advance(60_000); // a minute of writing between saves
      await session.saveBody(id, `Draft ${i}\n`);
    }
    // One at the first overwrite; the rest are inside the 30-minute window.
    expect(await session.listSnapshots(id)).toHaveLength(1);

    advance(31 * 60_000);
    await session.saveBody(id, "After a break\n");
    expect(await session.listSnapshots(id)).toHaveLength(2);
  });

  it("takes named manual snapshots and can restore one as a new document", async () => {
    const { session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "First draft.\n");
    const info = await session.takeSnapshot(id, "Before the rewrite");
    expect(info).toMatchObject({ kind: "manual", name: "Before the rewrite" });
    expect(info.counts.words).toBe(2);

    await session.saveBody(id, "Second draft, much longer now.\n");
    const copyId = await session.restoreSnapshotAsDocument(id, info.path);
    expect((await session.readDocument(copyId)).body).toBe("First draft.\n");
    expect((await session.readDocument(id)).body).toBe("Second draft, much longer now.\n");
    expect(titles(session)).toEqual(["Chapter 1", "Chapter 1 (snapshot)"]);
  });

  it("keeps snapshots as plain files outside docs/", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "Words.\n");
    await session.takeSnapshot(id);
    const paths = [...fs.files.keys()];
    expect(paths.some((p) => p.startsWith(`snapshots/${id}/`))).toBe(true);
    expect(paths.filter((p) => p.startsWith("docs/"))).toHaveLength(1);
    // A snapshot is a document file: readable in any text editor.
    const snapshotPath = paths.find((p) => p.startsWith("snapshots/")) as string;
    const file = parseDocFile((await fs.readText(snapshotPath)) ?? "", id).file;
    expect(file.body).toBe("Words.\n");
    expect(file.extra["snapshotOf"]).toBe(id);
  });
});

describe("counts, targets and search", () => {
  it("counts words per document, in any script", async () => {
    const { session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "The ferry left her on the jetty.\n\n她看见了灯塔。\n");
    const counts = session.snapshot().docs.get(id)?.counts;
    expect(counts).toMatchObject({ words: 7, cjk: 6 });
  });

  it("keeps counts across a reopen (from the cache)", async () => {
    const { fs, session } = await newProject();
    const index = new MemoryIndexStore();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "One two three four five.\n");
    const warm = await openSession(fs, index);
    expect(warm.snapshot().docs.get(id)?.counts.words).toBe(5);
    const reopened = await openSession(fs, index);
    expect(reopened.snapshot().docs.get(id)?.counts.words).toBe(5);
  });

  it("stores a per-document target and project goals", async () => {
    const { fs, session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.setTarget(id, 2000);
    await session.updateSettings({
      manuscriptTarget: 90000,
      deadline: "2026-12-31",
      sessionTarget: 1000,
    });

    const reopened = await openSession(fs);
    expect(reopened.snapshot().docs.get(id)?.meta.target).toBe(2000);
    expect(reopened.snapshot().project.settings).toMatchObject({
      manuscriptTarget: 90000,
      deadline: "2026-12-31",
      sessionTarget: 1000,
      countUnit: "words",
    });
  });

  it("finds text, titles and two-character Chinese words", async () => {
    const { session } = await newProject();
    const id = flatten(session.snapshot().tree)[0]?.id as string;
    await session.readDocument(id);
    await session.saveBody(id, "She waited by the lighthouse.\n\n她在灯塔旁等待。\n");
    const other = await session.createDocument({
      kind: "text",
      parent: "manuscript",
      title: "Lighthouse notes",
    });
    await session.readDocument(other);
    await session.saveBody(other, "Nothing to see.\n");

    expect((await session.search("lighthouse")).map((r) => r.id).sort()).toEqual(
      [id, other].sort(),
    );
    expect(await session.search("灯塔")).toMatchObject([{ id, field: "body" }]);
    expect((await session.search("waited by"))[0]?.snippet).toContain("waited by the lighthouse");
    expect(await session.search("nothing here at all")).toEqual([]);
  });
});

describe("migration harness", () => {
  const renameSynopsis: Migration = {
    from: 1,
    to: 2,
    describe: "test: rename frontmatter key 'synopsis' to 'summary'",
    async run(ctx, project) {
      for (const entry of await ctx.fs.list("docs")) {
        const path = `docs/${entry.name}`;
        await ctx.backup(path);
        const text = (await ctx.fs.readText(path)) ?? "";
        await ctx.fs.writeTextAtomic(path, text.replace(/^synopsis:/m, "summary:"));
      }
      return project;
    },
  };

  it("upgrades, backs up first, and bumps the version last", async () => {
    const { fs } = await newProject();
    await ProjectSession.open(
      fs,
      new MemoryIndexStore(),
      {
        rootKey: "m",
        defaultRoots: ROOTS,
        now,
        migrations: [renameSynopsis],
        targetVersion: 2,
      },
      { labels, now },
    );

    const project = parseProjectFile((await fs.readText(PROJECT_FILE)) ?? "", ROOTS);
    expect(project.ok && project.project.formatVersion).toBe(2);
    const backups = [...fs.files.keys()].filter((p) => p.startsWith(".sheaf-backup/"));
    expect(backups.some((p) => p.endsWith("/project.json"))).toBe(true);
    expect(backups.some((p) => p.includes("/docs/"))).toBe(true);
    const doc = [...fs.files.entries()].find(([p]) => p.startsWith("docs/"))?.[1].text ?? "";
    expect(doc).toContain("summary:");
  });

  it("fails cleanly when a step is missing", async () => {
    const { fs } = await newProject();
    await expect(
      ProjectSession.open(
        fs,
        new MemoryIndexStore(),
        { rootKey: "m", defaultRoots: ROOTS, now, migrations: [], targetVersion: 2 },
        { labels, now },
      ),
    ).rejects.toMatchObject({ code: "no-path" });
    const project = parseProjectFile((await fs.readText(PROJECT_FILE)) ?? "", ROOTS);
    expect(project.ok && project.project.formatVersion).toBe(1);
  });
});
