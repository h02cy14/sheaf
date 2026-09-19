/**
 * Autosave scheduling (ADR 0002): save shortly after typing pauses, but at
 * least every `maxWaitMs` while typing continues, and immediately on flush
 * (document switch, app hidden or closing). A failed save is retried with
 * backoff; the text stays in memory until a save succeeds.
 */
export type AutosaveStatus = "saved" | "saving" | "error";

export interface AutosaveOptions {
  debounceMs: number;
  maxWaitMs: number;
  retryMs: number;
}

const DEFAULTS: AutosaveOptions = { debounceMs: 500, maxWaitMs: 2000, retryMs: 2000 };

export class Autosaver {
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private running: Promise<void> | null = null;
  private failures = 0;
  private readonly options: AutosaveOptions;

  constructor(
    private readonly save: (docId: string) => Promise<void>,
    private readonly onStatus: (status: AutosaveStatus) => void,
    options: Partial<AutosaveOptions> = {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  get hasPending(): boolean {
    return this.dirty.size > 0 || this.running !== null;
  }

  markDirty(docId: string): void {
    this.dirty.add(docId);
    this.firstDirtyAt ??= this.now();
    this.onStatus("saving");
    this.schedule(this.options.debounceMs);
  }

  private schedule(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const waited = this.firstDirtyAt === null ? 0 : this.now() - this.firstDirtyAt;
    const wait = Math.max(0, Math.min(delay, this.options.maxWaitMs - waited));
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  /** Saves everything pending now. Resolves when done (or failed and rescheduled). */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Serialise flushes: wait for an in-flight one, then save what's left.
    while (this.running) await this.running;
    if (this.dirty.size === 0) return;

    const batch = [...this.dirty];
    this.dirty.clear();
    this.firstDirtyAt = null;
    this.running = (async () => {
      const failed: string[] = [];
      for (const docId of batch) {
        try {
          await this.save(docId);
        } catch {
          failed.push(docId);
        }
      }
      if (failed.length > 0) {
        for (const docId of failed) this.dirty.add(docId);
        this.firstDirtyAt ??= this.now();
        this.failures++;
        this.onStatus("error");
        this.timer = setTimeout(
          () => void this.flush(),
          Math.min(this.options.retryMs * 2 ** (this.failures - 1), 30000),
        );
      } else {
        this.failures = 0;
        if (this.dirty.size === 0) this.onStatus("saved");
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
