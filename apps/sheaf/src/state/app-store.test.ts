/**
 * The parts of the store that can be exercised without a project on disk:
 * the live counts the status bar reads, and the pane/focus flags.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";

const counts = (words: number) => ({ words, cjk: 0, characters: words * 5 });

beforeEach(() => {
  useAppStore.setState({
    live: {},
    activePane: "primary",
    secondDocId: null,
    focusMode: false,
  });
});

describe("live counts", () => {
  it("keeps one entry per pane and clears it with null", () => {
    const { setLiveCounts } = useAppStore.getState();
    setLiveCounts("primary", { docId: "a", counts: counts(10) });
    setLiveCounts("secondary", { docId: "b", counts: counts(4) });
    expect(useAppStore.getState().live).toEqual({
      primary: { docId: "a", counts: counts(10) },
      secondary: { docId: "b", counts: counts(4) },
    });

    setLiveCounts("secondary", null);
    expect(useAppStore.getState().live).toEqual({
      primary: { docId: "a", counts: counts(10) },
    });
  });

  it("ignores an unchanged count, so typing doesn't re-render the app", () => {
    const { setLiveCounts } = useAppStore.getState();
    setLiveCounts("primary", { docId: "a", counts: counts(10) });
    const first = useAppStore.getState().live;
    setLiveCounts("primary", { docId: "a", counts: counts(10) });
    expect(useAppStore.getState().live).toBe(first);

    setLiveCounts("primary", { docId: "a", counts: counts(11) });
    expect(useAppStore.getState().live).not.toBe(first);
  });
});

describe("panes and focus mode", () => {
  it("won't make a closed second pane the active one", () => {
    useAppStore.getState().setActivePane("secondary");
    expect(useAppStore.getState().activePane).toBe("primary");

    useAppStore.setState({ secondDocId: "b" });
    useAppStore.getState().setActivePane("secondary");
    expect(useAppStore.getState().activePane).toBe("secondary");
  });

  it("closing the split returns to the first pane and forgets its counts", () => {
    useAppStore.setState({ secondDocId: "b", activePane: "secondary" });
    useAppStore.getState().setLiveCounts("primary", { docId: "a", counts: counts(10) });
    useAppStore.getState().setLiveCounts("secondary", { docId: "b", counts: counts(4) });

    useAppStore.getState().toggleSplit();
    expect(useAppStore.getState().secondDocId).toBeNull();
    expect(useAppStore.getState().activePane).toBe("primary");
    expect(useAppStore.getState().live).toEqual({
      primary: { docId: "a", counts: counts(10) },
    });
  });

  it("toggles focus mode", () => {
    useAppStore.getState().toggleFocusMode();
    expect(useAppStore.getState().focusMode).toBe(true);
    useAppStore.getState().setFocusMode(false);
    expect(useAppStore.getState().focusMode).toBe(false);
  });
});
