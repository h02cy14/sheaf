/// <reference types="node" />
/**
 * Brief §4: "project.db is a rebuildable cache — if it's deleted, the app
 * reconstructs it from the files on disk. Write a test that proves this."
 *
 * Runs against a real folder on disk and a real SQLite database.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RootId } from "../format/types";
import { openIndex, SqliteIndexStore } from "./index-store";
import { NodeFs, nodeSqliteFactory } from "./node-adapters.testutil";
import { ProjectSession } from "./session";
import { flatten } from "./tree";

const ROOTS: Record<RootId, string> = {
  manuscript: "Manuscript",
  research: "Research",
  trash: "Trash",
};
const labels = {
  untitled: "Untitled",
  newFolder: "New Folder",
  conflictCopy: (t: string) => `${t} (copy)`,
};

let dir: string;
let projectDir: string;
let dbFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sheaf-index-"));
  projectDir = join(dir, "Novel.sheaf");
  dbFile = join(dir, "cache", "index.db");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function open(): Promise<{ session: ProjectSession; recovered: boolean }> {
  const { store, recovered } = await openIndex(nodeSqliteFactory(dbFile));
  const session = await ProjectSession.open(
    new NodeFs(projectDir),
    store,
    { rootKey: projectDir, defaultRoots: ROOTS },
    { labels },
  );
  return { session, recovered };
}

/** Everything the binder shows, in order: id, title, parent, synopsis. */
function binder(session: ProjectSession): string[] {
  const tree = session.snapshot().tree;
  return flatten(tree).map((n) =>
    [n.id, n.meta.title, tree.displayParent.get(n.id), n.meta.synopsis].join("|"),
  );
}

async function buildProject(): Promise<string[]> {
  const fs = new NodeFs(projectDir);
  await fs.mkdir("");
  await ProjectSession.createProject(fs, {
    title: "Novel",
    roots: ROOTS,
    firstDocumentTitle: "Opening",
    now: new Date(),
  });
  const { session } = await open();
  const part = await session.createDocument({
    kind: "folder",
    parent: "manuscript",
    title: "Part One",
  });
  for (let i = 0; i < 20; i++) {
    const id = await session.createDocument({
      kind: "text",
      parent: i < 10 ? part : "manuscript",
      title: `Scene ${i}`,
    });
    await session.readDocument(id);
    await session.saveBody(id, `Text of scene ${i}.\n`);
    if (i % 5 === 0) await session.setSynopsis(id, `Synopsis ${i}`);
  }
  const moved = flatten(session.snapshot().tree).find((n) => n.meta.title === "Scene 15")
    ?.id as string;
  await session.move([moved], part, "into");
  await session.trash([
    flatten(session.snapshot().tree).find((n) => n.meta.title === "Scene 19")?.id as string,
  ]);
  const shape = binder(session);
  await session.close();
  return shape;
}

describe("project.db is a rebuildable cache", () => {
  it("is actually used: a warm open reads no files", async () => {
    await buildProject();
    const { session } = await open();
    expect(session.scan).toMatchObject({ files: 22, reread: 0, cacheRebuilt: false });
    await session.close();
  });

  it("is rebuilt identically after being deleted", async () => {
    const before = await buildProject();
    await rm(join(dir, "cache"), { recursive: true, force: true });

    const { session } = await open();
    expect(session.scan).toMatchObject({ files: 22, reread: 22, cacheRebuilt: true });
    expect(binder(session)).toEqual(before);
    await session.close();

    // …and the rebuilt cache is complete: the next open reads nothing.
    const { session: warm } = await open();
    expect(warm.scan.reread).toBe(0);
    expect(binder(warm)).toEqual(before);
    await warm.close();
  });

  it("is rebuilt identically after being corrupted", async () => {
    const before = await buildProject();
    await writeFile(dbFile, "this is not a SQLite database, it is garbage ".repeat(200));

    const { session, recovered } = await open();
    expect(recovered).toBe(true);
    expect(session.scan.reread).toBe(22);
    expect(binder(session)).toEqual(before);
    await session.close();
  });

  it("is ignored when it belongs to a different folder", async () => {
    const before = await buildProject();
    const { store } = await openIndex(nodeSqliteFactory(dbFile));
    await (store as SqliteIndexStore).reset({
      schemaVersion: 1,
      projectId: "someone-else",
      rootKey: "/elsewhere",
    });
    await store.close();

    const { session } = await open();
    expect(session.scan.cacheRebuilt).toBe(true);
    expect(binder(session)).toEqual(before);
    await session.close();
  });

  it("never lives inside the project folder", async () => {
    await buildProject();
    const entries = await readdir(projectDir);
    expect(entries.sort()).toEqual(["docs", "project.json"]);
    const docs = await readdir(join(projectDir, "docs"));
    expect(docs.every((n) => /^[0-9A-Z]{26}\.md$/.test(n))).toBe(true); // no temp files left behind
  });
});
