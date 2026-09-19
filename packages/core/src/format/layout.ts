/**
 * Where things live inside a project folder (ADR 0002). Paths are always
 * project-relative with "/" separators; the shell maps them to the OS.
 */
export const PROJECT_FILE = "project.json";
export const DOCS_DIR = "docs";
export const BACKUP_DIR = ".sheaf-backup";

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
