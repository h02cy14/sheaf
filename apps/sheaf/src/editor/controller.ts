/**
 * Everything about the writing surface that isn't React: the ProseMirror
 * view, per-document editor states, loading, and autosave. The React
 * component attaches it to a DOM node and re-renders the toolbar when it
 * says so.
 */
import { parseMarkdown, schema, serializeMarkdown, type ProjectSession } from "@sheaf/core";
import { EditorState, type Command, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Autosaver, type AutosaveStatus } from "./autosave";
import { GrammarChecker, type GrammarContext } from "./grammar/checker";
import { setGrammar } from "./grammar/plugin";

export interface EditorControllerOptions {
  session: () => ProjectSession;
  plugins: () => Plugin[];
  attributes: () => Record<string, string>;
  onStatus: (status: AutosaveStatus) => void;
  /** Our text was kept as `copyId` because the file changed elsewhere. */
  onConflict: (docId: string, copyId: string) => void;
  /** Language settings for checking, or null while no project is open. */
  grammarContext?: () => GrammarContext | null;
}

export class EditorController {
  private view: EditorView | null = null;
  private loadedId: string | null = null;
  private typewriter = false;
  private loading: string | null = null;
  private focusAfterLoad = false;
  private readonly states = new Map<string, EditorState>();
  /** Markdown last read from or written to disk, per document: skip no-op saves. */
  private readonly saved = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  readonly saver: Autosaver;
  readonly checker: GrammarChecker;

  constructor(private readonly options: EditorControllerOptions) {
    this.saver = new Autosaver((docId) => this.save(docId), options.onStatus);
    this.checker = new GrammarChecker({
      view: () => this.view,
      context: () => (this.loadedId === null ? null : (options.grammarContext?.() ?? null)),
    });
  }

  // ------------------------------------------------------ React plumbing

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = (): number => this.revision;

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  // ---------------------------------------------------------- lifecycle

  attach(mount: HTMLElement): void {
    this.view?.destroy();
    const view: EditorView = new EditorView(mount, {
      state: EditorState.create({ schema }),
      editable: () => this.loadedId !== null,
      attributes: this.options.attributes(),
      ...this.scrollProps(),
      dispatchTransaction: (tr) => {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged && this.loadedId) {
          this.saver.markDirty(this.loadedId);
          this.checker.schedule();
        }
        this.changed();
      },
    });
    this.view = view;
  }

  /**
   * Tears down the view and saves pending edits. The view is released
   * synchronously (its text kept in `states`), so a quick re-attach, as
   * React StrictMode does and mobile lifecycles can, gets a clean slate
   * and the same content.
   */
  async detach(): Promise<void> {
    const view = this.view;
    if (view && this.loadedId) this.states.set(this.loadedId, view.state);
    this.view = null;
    this.loadedId = null;
    this.loading = null;
    this.checker.stop();
    view?.destroy();
    await this.saver.flush();
  }

  refreshAttributes(): void {
    this.view?.setProps({ attributes: this.options.attributes() });
  }

  /**
   * Typewriter scrolling: the line being written stays near the middle of
   * the pane instead of drifting to the bottom edge. ProseMirror keeps the
   * cursor `scrollMargin` away from the edge of the scroll container, so a
   * margin of half the pane height centres it.
   */
  private scrollProps(): { scrollMargin: number; scrollThreshold: number } {
    const height = this.view?.dom.clientHeight || window.innerHeight;
    const margin = this.typewriter ? Math.max(0, Math.round(height * 0.4)) : 5;
    return { scrollMargin: margin, scrollThreshold: margin };
  }

  setTypewriter(on: boolean): void {
    if (this.typewriter === on) return;
    this.typewriter = on;
    this.view?.setProps(this.scrollProps());
    if (on) this.scrollCursorIntoView();
  }

  private scrollCursorIntoView(): void {
    const view = this.view;
    if (!view || !this.loadedId) return;
    view.dispatch(view.state.tr.scrollIntoView());
  }

  // ------------------------------------------------------------- content

  get state(): EditorState | null {
    return this.loadedId ? (this.view?.state ?? null) : null;
  }

  /** The live view, for UI that has to position itself over the text. */
  get editorView(): EditorView | null {
    return this.view;
  }

  get activeId(): string | null {
    return this.loadedId;
  }

  /** The text of the document on screen, for counting. */
  plainText(): string | null {
    const state = this.state;
    if (!state) return null;
    return state.doc.textBetween(0, state.doc.content.size, "\n", "\n");
  }

  /**
   * Puts different text in front of the writer for a document Sheaf itself
   * just rewrote (a snapshot restore). The undo history starts fresh: the
   * previous text is a snapshot, not an undo step.
   */
  replace(docId: string, body: string): void {
    const state = EditorState.create({
      doc: parseMarkdown(body),
      plugins: this.options.plugins(),
    });
    this.states.set(docId, state);
    this.saved.set(docId, body);
    if (this.loadedId === docId) {
      this.view?.updateState(state);
      this.checker.refresh();
    }
    this.changed();
  }

  /** Shows `docId`. Keeps the cached state (and its undo history) if the file hasn't changed. */
  async load(docId: string): Promise<void> {
    const view = this.view;
    if (!view || this.loadedId === docId) return;
    if (this.loadedId) this.states.set(this.loadedId, view.state);
    this.loading = docId;
    const file = await this.options.session().readDocument(docId);
    if (this.loading !== docId || !this.view) return; // superseded by a newer load
    this.loading = null;

    const diskDoc = parseMarkdown(file.body);
    const cached = this.states.get(docId);
    const state =
      cached && serializeMarkdown(cached.doc) === serializeMarkdown(diskDoc)
        ? cached
        : EditorState.create({ doc: diskDoc, plugins: this.options.plugins() });
    this.saved.set(docId, file.body);
    this.loadedId = docId;
    this.view.updateState(state);
    this.checker.refresh();
    if (this.focusAfterLoad) {
      this.focusAfterLoad = false;
      this.view.focus();
    }
    this.changed();
  }

  /** Clears the surface (no document selected). */
  unload(): void {
    this.checker.clear();
    if (this.loadedId && this.view) this.states.set(this.loadedId, this.view.state);
    this.loadedId = null;
    this.loading = null;
    this.changed();
  }

  private async save(docId: string): Promise<void> {
    const state = docId === this.loadedId && this.view ? this.view.state : this.states.get(docId);
    if (!state) return;
    const markdown = serializeMarkdown(state.doc);
    if (this.saved.get(docId) === markdown) return;
    const result = await this.options.session().saveBody(docId, markdown);
    if (result.status === "saved") {
      this.saved.set(docId, markdown);
      return;
    }
    // Changed elsewhere: our text now lives in the conflict copy; show theirs.
    const fresh = EditorState.create({
      doc: parseMarkdown(result.diskBody),
      plugins: this.options.plugins(),
    });
    this.states.set(docId, fresh);
    this.saved.set(docId, result.diskBody);
    this.saved.set(result.copyId, markdown);
    if (this.loadedId === docId) this.view?.updateState(fresh);
    this.options.onConflict(docId, result.copyId);
    this.changed();
  }

  // ------------------------------------------------------------ commands

  run(command: Command): void {
    const view = this.view;
    if (!view || !this.loadedId) return;
    command(view.state, view.dispatch, view);
    view.focus();
  }

  /** Closes an open suggestion card. */
  closeSuggestion(): void {
    const view = this.view;
    if (!view) return;
    view.dispatch(setGrammar(view.state.tr, { open: null }));
  }

  /** Focuses the text now, or as soon as the document being loaded is ready. */
  focus(): void {
    if (this.view && this.loadedId && !this.loading) this.view.focus();
    else this.focusAfterLoad = true;
  }
}
