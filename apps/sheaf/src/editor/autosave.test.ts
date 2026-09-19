import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type AutosaveStatus } from "./autosave";

describe("Autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(save: (id: string) => Promise<void> = () => Promise.resolve()) {
    const saved: string[] = [];
    const statuses: AutosaveStatus[] = [];
    const saver = new Autosaver(
      async (id) => {
        await save(id);
        saved.push(id);
      },
      (s) => statuses.push(s),
      { debounceMs: 500, maxWaitMs: 2000, retryMs: 1000 },
      () => Date.now(),
    );
    return { saver, saved, statuses };
  }

  it("saves once typing pauses", async () => {
    const { saver, saved, statuses } = setup();
    saver.markDirty("a");
    await vi.advanceTimersByTimeAsync(400);
    saver.markDirty("a");
    await vi.advanceTimersByTimeAsync(400);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(saved).toEqual(["a"]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("saves at least every maxWait while typing continues", async () => {
    const { saver, saved } = setup();
    for (let t = 0; t < 2100; t += 100) {
      saver.markDirty("a");
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(saved.length).toBeGreaterThanOrEqual(1);
  });

  it("flush saves immediately", async () => {
    const { saver, saved } = setup();
    saver.markDirty("a");
    saver.markDirty("b");
    await saver.flush();
    expect(saved.sort()).toEqual(["a", "b"]);
    expect(saver.hasPending).toBe(false);
  });

  it("retries failed saves and keeps the document dirty meanwhile", async () => {
    let fail = true;
    const { saver, saved, statuses } = setup(() =>
      fail ? Promise.reject(new Error("disk full")) : Promise.resolve(),
    );
    saver.markDirty("a");
    await vi.advanceTimersByTimeAsync(500);
    expect(statuses.at(-1)).toBe("error");
    expect(saver.hasPending).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual(["a"]);
    expect(statuses.at(-1)).toBe("saved");
  });
});
