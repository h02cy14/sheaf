/**
 * Per-device conveniences kept in localStorage: recently opened projects and
 * the last document open in each project (so Sheaf resumes where you left
 * off). Losing this data costs nothing but convenience, so every access is
 * guarded.
 */
export interface RecentProject {
  root: string;
  name: string;
  openedAt: number;
}

const RECENTS = "sheaf.recentProjects.v1";
const LAST_DOC = "sheaf.lastDocument.v1";
const MAX_RECENTS = 12;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembering is acceptable.
  }
}

export function recentProjects(): RecentProject[] {
  const list = read<RecentProject[]>(RECENTS, []);
  return Array.isArray(list) ? list.filter((p) => typeof p?.root === "string") : [];
}

export function rememberProject(root: string, name: string, now = Date.now()): void {
  const rest = recentProjects().filter((p) => p.root !== root);
  write(RECENTS, [{ root, name, openedAt: now }, ...rest].slice(0, MAX_RECENTS));
}

export function forgetProject(root: string): void {
  write(
    RECENTS,
    recentProjects().filter((p) => p.root !== root),
  );
}

export function lastDocument(projectId: string): string | null {
  const map = read<Record<string, string>>(LAST_DOC, {});
  return typeof map[projectId] === "string" ? map[projectId] : null;
}

export function rememberDocument(projectId: string, docId: string): void {
  write(LAST_DOC, { ...read<Record<string, string>>(LAST_DOC, {}), [projectId]: docId });
}
