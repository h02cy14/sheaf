/**
 * Runs the checker while the writer thinks, never while they type.
 *
 * The rules from the brief (§7) that shape this file:
 * - checking happens off the main thread — Harper runs in Rust, on a
 *   background thread, so the editor is only ever waiting on a promise;
 * - it is debounced on a pause, not on a keystroke;
 * - every paragraph is routed by language first, and a paragraph the policy
 *   says to leave alone is never sent anywhere.
 */
import {
  chooseChecker,
  languageFor,
  paragraphLanguage,
  type CheckerAvailability,
  type CheckerSettings,
  type ParagraphLanguages,
} from "@sheaf/core";
import type { EditorView } from "prosemirror-view";
import { checkEnglish, type GrammarLint } from "../../platform/grammar";
import { checkWithLanguageTool } from "../../platform/languagetool";
import { textBlocks, type TextBlock } from "./blocks";
import { setGrammar, type BlockLanguage, type Problem } from "./plugin";

/** Everything outside the editor that the checker needs to decide. */
export interface GrammarContext extends CheckerSettings {
  /** The project's language, used when a paragraph is too short to judge. */
  projectLanguage: string | null;
  /** The language the writer declared for this document, if any. */
  documentLanguage: string | null;
  /** Languages the writer chose for individual paragraphs. */
  paragraphLanguages: ParagraphLanguages;
  dialect: string;
  dictionary: readonly string[];
  /** `kind|text` entries the writer has told Sheaf to stop flagging. */
  ignored: readonly string[];
  available: CheckerAvailability;
}

export interface CheckerOptions {
  view: () => EditorView | null;
  context: () => GrammarContext | null;
  /** Pause after typing before checking, in milliseconds. */
  delayMs?: number;
}

const DEFAULT_DELAY = 700;
/** Paragraphs are joined into one request up to this size. */
const BATCH_CHARS = 20_000;
const JOIN = "\n\n";
const CACHE_LIMIT = 600;

interface Group {
  language: string;
  engine: "harper" | "languagetool";
  blocks: TextBlock[];
}

export class GrammarChecker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  /** Results per paragraph, so untouched paragraphs are never re-sent. */
  private readonly cache = new Map<string, GrammarLint[]>();
  private cacheStamp = "";

  constructor(private readonly options: CheckerOptions) {}

  /** Called when the document changes; checks once typing stops. */
  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.options.delayMs ?? DEFAULT_DELAY);
  }

  /** Checks now (used when the settings or the document language change). */
  refresh(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    void this.run();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  clear(): void {
    this.stop();
    const view = this.options.view();
    if (view) {
      view.dispatch(
        setGrammar(view.state.tr, {
          problems: [],
          blocks: [],
          counts: { checked: 0, skipped: 0 },
          open: null,
        }),
      );
    }
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    const view = this.options.view();
    const context = this.options.context();
    if (!view || !context) return;

    this.running = true;
    try {
      await this.check(view, context);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  private async check(view: EditorView, context: GrammarContext): Promise<void> {
    // Settings that change what a result means invalidate the cache.
    const stamp = [
      context.dialect,
      context.dictionary.join("\u0000"),
      context.languageToolEndpoint ?? "",
      String(context.checkGrammar),
    ].join("|");
    if (stamp !== this.cacheStamp) {
      this.cache.clear();
      this.cacheStamp = stamp;
    }

    const startedWith = view.state.doc;
    const blocks = textBlocks(startedWith);
    const groups: Group[] = [];
    const decisions: BlockLanguage[] = [];
    let checked = 0;
    let skipped = 0;

    for (const block of blocks) {
      const chosen = paragraphLanguage(context.paragraphLanguages, block.text);
      const language = languageFor(
        block.text,
        chosen ?? context.documentLanguage,
        context.projectLanguage,
      );
      const choice = chooseChecker(language, context, context.available);
      decisions.push({
        pos: block.pos,
        language,
        reason: choice.reason ?? null,
        text: block.text,
        overridden: chosen !== null,
      });
      if (choice.engine === "none") skipped++;
      else checked++;
      if (choice.engine === "none") continue;

      const last = groups.at(-1);
      const size = last ? last.blocks.reduce((n, b) => n + b.text.length + JOIN.length, 0) : 0;
      if (
        last &&
        last.language === language &&
        last.engine === choice.engine &&
        size < BATCH_CHARS
      ) {
        last.blocks.push(block);
      } else {
        groups.push({ language, engine: choice.engine, blocks: [block] });
      }
    }

    const counts = { checked, skipped };

    const ignored = new Set(context.ignored);
    const problems: Problem[] = [];
    for (const group of groups) {
      const lints = await this.lintsFor(group, context);
      if (view.state.doc !== startedWith) {
        // The writer carried on typing: these positions are stale.
        this.schedule();
        return;
      }
      problems.push(...toProblems(group, lints, ignored));
    }

    // The editor may have been torn down while an engine was thinking (a
    // document switch, a closed project): never dispatch into a dead view.
    if (this.options.view() !== view) return;
    view.dispatch(setGrammar(view.state.tr, { problems, blocks: decisions, counts, busy: false }));
  }

  /** One engine call per group of paragraphs, with per-paragraph caching. */
  private async lintsFor(group: Group, context: GrammarContext): Promise<GrammarLint[][]> {
    const keyOf = (text: string): string => `${group.engine}\u0000${group.language}\u0000${text}`;
    const missing = group.blocks.filter((block) => !this.cache.has(keyOf(block.text)));

    if (missing.length > 0) {
      const text = missing.map((block) => block.text).join(JOIN);
      let lints: GrammarLint[] | null;
      try {
        lints =
          group.engine === "harper"
            ? await checkEnglish({
                text,
                dialect: context.dialect,
                dictionary: context.dictionary,
              })
            : await checkWithLanguageTool({
                endpoint: context.languageToolEndpoint ?? "",
                text,
                language: group.language,
              });
      } catch {
        // A checker that is unavailable or unhappy must never cost the
        // writer anything: no underlines this time, and no message. The
        // failure is not remembered either — a server that comes back up, or
        // a moment of bad luck, should not leave paragraphs unchecked until
        // they are edited.
        lints = null;
      }
      if (lints !== null) {
        // Split the batch back into paragraphs.
        let offset = 0;
        for (const block of missing) {
          const end = offset + block.text.length;
          const mine = lints
            .filter((lint) => lint.start >= offset && lint.end <= end)
            .map((lint) => ({ ...lint, start: lint.start - offset, end: lint.end - offset }));
          this.remember(keyOf(block.text), mine);
          offset = end + JOIN.length;
        }
      }
    }

    return group.blocks.map((block) => this.cache.get(keyOf(block.text)) ?? []);
  }

  private remember(key: string, lints: GrammarLint[]): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, lints);
  }
}

function toProblems(group: Group, perBlock: GrammarLint[][], ignored: Set<string>): Problem[] {
  const problems: Problem[] = [];
  group.blocks.forEach((block, index) => {
    for (const lint of perBlock[index] ?? []) {
      const text = block.text.slice(lint.start, lint.end);
      if (ignored.has(`${lint.kind}|${text}`)) continue;
      problems.push({
        from: block.positionAt(lint.start),
        to: block.positionAt(lint.end),
        kind: lint.kind,
        message: lint.message,
        suggestions: lint.suggestions,
        text,
        language: group.language,
      });
    }
  });
  return problems;
}
