/**
 * Application state: which screen is showing, the open project session, the
 * binder selection and the active document. Document text itself lives in
 * the editor (see editor/bridge.ts), not here.
 */
import {
  flatten,
  ProjectOpenError,
  ProjectSession,
  readProjectFile,
  type RootId,
  type SessionSnapshot,
} from "@sheaf/core";
import i18next from "i18next";
import { create } from "zustand";
import { editorBridge } from "../editor/bridge";
import {
  displayName,
  getStorage,
  type AttachedProject,
  type ProjectLocation,
  type Storage,
} from "../platform";
import {
  forgetProject,
  lastDocument,
  recentProjects,
  rememberDocument,
  rememberProject,
} from "./recent";

export type Screen = "starting" | "home" | "opening" | "project";
export type SaveStatus = "saved" | "saving" | "error";

interface OpenProject {
  root: string;
  attached: AttachedProject;
  session: ProjectSession;
  unsubscribe: () => void;
}

export interface Notice {
  id: number;
  text: string;
  tone: "info" | "warning";
}

export interface AppState {
  screen: Screen;
  storage: Storage | null;
  projects: ProjectLocation[];
  error: string | null;
  open: OpenProject | null;
  snapshot: SessionSnapshot | null;
  selection: string[];
  activeDocId: string | null;
  saveStatus: SaveStatus;
  notices: Notice[];

  start(): Promise<void>;
  refreshProjects(): Promise<void>;
  createProject(): Promise<void>;
  openProject(root: string): Promise<void>;
  pickAndOpenProject(): Promise<void>;
  closeProject(): Promise<void>;
  setSelection(ids: string[]): void;
  openDocument(id: string | null): Promise<void>;
  setSaveStatus(status: SaveStatus): void;
  notify(text: string, tone?: Notice["tone"]): void;
  dismissNotice(id: number): void;
}

function rootLabels(): Record<RootId, string> {
  return {
    manuscript: i18next.t("binder.roots.manuscript"),
    research: i18next.t("binder.roots.research"),
    trash: i18next.t("binder.roots.trash"),
  };
}

function sessionLabels() {
  return {
    untitled: i18next.t("session.untitled"),
    newFolder: i18next.t("session.newFolder"),
    conflictCopy: (title: string) => i18next.t("session.conflictCopy", { title }),
  };
}

function describeOpenError(error: unknown): string {
  if (error instanceof ProjectOpenError) {
    if (error.code === "not-a-project") return i18next.t("home.errors.notAProject");
    if (error.code === "newer-format") return i18next.t("home.errors.newerFormat");
  }
  const message = error instanceof Error ? error.message : String(error);
  return i18next.t("home.errors.generic", { message });
}

let noticeId = 0;

export const useAppStore = create<AppState>()((set, get) => ({
  screen: "starting",
  storage: null,
  projects: [],
  error: null,
  open: null,
  snapshot: null,
  selection: [],
  activeDocId: null,
  saveStatus: "saved",
  notices: [],

  async start() {
    const storage = await getStorage();
    set({ storage });
    await get().refreshProjects();
    // Resume where the user left off.
    const last = recentProjects()[0];
    if (last) {
      await get().openProject(last.root);
      if (get().screen === "project") return;
      set({ error: null }); // A vanished last project shouldn't greet the user with an error.
    }
    set({ screen: "home" });
  },

  async refreshProjects() {
    const storage = get().storage;
    if (!storage) return;
    try {
      const found = await storage.listProjects();
      const recents = recentProjects();
      const byRoot = new Map<string, ProjectLocation>();
      for (const p of found) byRoot.set(p.root, p);
      for (const r of recents) {
        if (!byRoot.has(r.root))
          byRoot.set(r.root, { root: r.root, name: r.name, modifiedMs: r.openedAt });
      }
      const openedAt = new Map(recents.map((r) => [r.root, r.openedAt]));
      const projects = [...byRoot.values()].sort(
        (a, b) => (openedAt.get(b.root) ?? b.modifiedMs) - (openedAt.get(a.root) ?? a.modifiedMs),
      );
      set({ projects });
    } catch {
      set({ projects: [] });
    }
  },

  async createProject() {
    const storage = get().storage;
    if (!storage) return;
    set({ screen: "opening", error: null });
    try {
      const title = i18next.t("home.defaultTitle");
      const root = await storage.createProjectFolder(title);
      const attached = await storage.attach(root);
      await ProjectSession.createProject(attached.fs, {
        title: displayName(root),
        roots: rootLabels(),
        firstDocumentTitle: i18next.t("session.firstDocument"),
        now: new Date(),
      });
      await attached.detach();
      await get().openProject(root);
      // First sentence within seconds: land in the body, ready to type.
      editorBridge.focusBody();
    } catch (error) {
      set({ screen: "home", error: describeOpenError(error) });
    }
  },

  async openProject(root) {
    const storage = get().storage;
    if (!storage) return;
    if (get().open) await get().closeProject();
    set({ screen: "opening", error: null });

    let attached: AttachedProject | null = null;
    try {
      attached = await storage.attach(root);
      const project = await readProjectFile(attached.fs, rootLabels());
      const index = await attached.openIndex(project.id);
      const session = await ProjectSession.open(
        attached.fs,
        index,
        { rootKey: attached.rootKey, defaultRoots: rootLabels() },
        { labels: sessionLabels() },
      );
      const unsubscribe = session.subscribe(() => {
        const snapshot = session.snapshot();
        const { activeDocId, selection } = get();
        set({
          snapshot,
          // Drop references to documents that no longer exist.
          activeDocId: activeDocId && snapshot.docs.has(activeDocId) ? activeDocId : null,
          selection: selection.filter((id) => snapshot.docs.has(id)),
        });
      });
      const snapshot = session.snapshot();
      rememberProject(root, displayName(root));

      const remembered = lastDocument(snapshot.project.id);
      const firstText = flatten(snapshot.tree, "manuscript").find((n) => n.meta.kind === "text");
      const active =
        remembered && snapshot.docs.has(remembered) ? remembered : (firstText?.id ?? null);

      set({
        screen: "project",
        open: { root, attached, session, unsubscribe },
        snapshot,
        selection: active ? [active] : [],
        activeDocId: active,
        saveStatus: "saved",
      });

      if (snapshot.conflicts.length > 0) {
        get().notify(
          i18next.t("project.conflictsFound", { count: snapshot.conflicts.length }),
          "warning",
        );
      }
    } catch (error) {
      await attached?.detach().catch(() => undefined);
      if (error instanceof ProjectOpenError && error.code === "not-a-project") forgetProject(root);
      set({ screen: "home", error: describeOpenError(error), open: null, snapshot: null });
      await get().refreshProjects();
    }
  },

  async pickAndOpenProject() {
    const storage = get().storage;
    if (!storage?.canPickFolders) return;
    const root = await storage.pickProjectFolder(i18next.t("home.openFolderTitle"));
    if (root) await get().openProject(root);
  },

  async closeProject() {
    const open = get().open;
    if (!open) return;
    await editorBridge.flush();
    open.unsubscribe();
    await open.session.close();
    await open.attached.detach().catch(() => undefined);
    set({ open: null, snapshot: null, selection: [], activeDocId: null, screen: "home" });
    await get().refreshProjects();
  },

  setSelection(ids) {
    set({ selection: ids });
  },

  async openDocument(id) {
    if (id === get().activeDocId) return;
    await editorBridge.flush();
    set({ activeDocId: id });
    const project = get().snapshot?.project;
    if (id && project) rememberDocument(project.id, id);
  },

  setSaveStatus(saveStatus) {
    if (get().saveStatus !== saveStatus) set({ saveStatus });
  },

  notify(text, tone = "info") {
    const notice = { id: ++noticeId, text, tone };
    set({ notices: [...get().notices, notice] });
    setTimeout(() => get().dismissNotice(notice.id), tone === "warning" ? 12000 : 6000);
  },

  dismissNotice(id) {
    set({ notices: get().notices.filter((n) => n.id !== id) });
  },
}));

/** The open session, for components that act on it. Throws if none is open. */
export function currentSession(): ProjectSession {
  const open = useAppStore.getState().open;
  if (!open) throw new Error("No project is open.");
  return open.session;
}
