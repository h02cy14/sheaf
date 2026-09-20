/**
 * Where things live inside a project folder (ADR 0002). Paths are always
 * project-relative with "/" separators; the shell maps them to the OS.
 */
export const PROJECT_FILE = "project.json";
export const DOCS_DIR = "docs";
export const SNAPSHOTS_DIR = "snapshots";
export const BACKUP_DIR = ".sheaf-backup";

/** Past versions of one document: `snapshots/<doc-id>/<when>-<kind>.md`. */
export function snapshotDir(docId: string): string {
  return `${SNAPSHOTS_DIR}/${docId}`;
}

export function snapshotPath(docId: string, at: Date, kind: string, suffix: string): string {
  const when = at.toISOString().replace(/[:.]/g, "-");
  return `${snapshotDir(docId)}/${when}-${kind}-${suffix}.md`;
}

/** Reads back what `snapshotPath` encoded, for listing without opening files. */
export function parseSnapshotName(name: string): { at: string; kind: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-z-]+)-[^.]+\.md$/.exec(name);
  if (!match) return null;
  const [, stamp, kind] = match as unknown as [string, string, string];
  const at = `${stamp.slice(0, 10)}T${stamp.slice(11, 13)}:${stamp.slice(14, 16)}:${stamp.slice(17, 19)}.${stamp.slice(20, 23)}Z`;
  return { at, kind };
}

/** Conventional (not required) extension for project folders. */
export const PROJECT_EXTENSION = ".sheaf";

export function docPath(id: string): string {
  return `${DOCS_DIR}/${id}.md`;
}

/** Leftovers of an interrupted atomic write: `.<name>.<suffix>.tmp`. */
export function isTempFileName(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".tmp");
}

export function isDocFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".md") && !name.startsWith(".");
}
