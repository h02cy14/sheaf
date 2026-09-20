import {
  diffParagraphs,
  paragraphsOf,
  wordTotal,
  type SnapshotInfo,
  type TextCounts,
} from "@sheaf/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { editorBridge } from "../editor/bridge";
import { currentSession, useAppStore } from "../state/app-store";
import { ParagraphDiffView } from "./Diff";
import styles from "./HistoryDialog.module.css";

function useSnapshots(docId: string): {
  snapshots: SnapshotInfo[] | null;
  error: string | null;
  reload: () => void;
} {
  const [loaded, setLoaded] = useState<{ key: string; list: SnapshotInfo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // A list from a previous document or a previous reload still counts as
  // "loading", so a stale list is never shown as the current one.
  const key = `${docId}:${nonce}`;

  useEffect(() => {
    let cancelled = false;
    currentSession()
      .listSnapshots(docId)
      .then(
        (list) => {
          if (!cancelled) setLoaded({ key, list });
        },
        (e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [docId, key]);

  return {
    snapshots: loaded?.key === key ? loaded.list : null,
    error,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

/**
 * Past versions of the document in front of you (brief §5): Sheaf keeps one
 * automatically before overwriting text it hasn't kept recently, and you can
 * keep one yourself at any time. Nothing here deletes anything — restoring
 * keeps the current text as a snapshot first.
 */
export function HistoryDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const title = useAppStore((s) => s.snapshot?.docs.get(docId)?.meta.title ?? "");
  const unit = useAppStore((s) => s.snapshot?.project.settings.countUnit ?? "words");
  const openDocument = useAppStore((s) => s.openDocument);
  const notify = useAppStore((s) => s.notify);
  const { snapshots, error, reload } = useSnapshots(docId);
  const [selected, setSelected] = useState<SnapshotInfo | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<{ path: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const snapshotBody =
    selected !== null && loadedSnapshot?.path === selected.path ? loadedSnapshot.body : null;

  // The diff compares what's on disk, so save anything still being typed.
  useEffect(() => {
    let cancelled = false;
    void editorBridge
      .flush()
      .then(() => currentSession().readDocument(docId))
      .then((file) => {
        if (!cancelled) setCurrent(file.body);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const selectedPath = selected?.path ?? null;
  useEffect(() => {
    if (selectedPath === null) return;
    let cancelled = false;
    void currentSession()
      .readSnapshot(selectedPath)
      .then((file) => {
        if (!cancelled) setLoadedSnapshot({ path: selectedPath, body: file.body });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const number = new Intl.NumberFormat(i18n.language);
  const countLabel = (counts: TextCounts): string => {
    const value = unit === "characters" ? counts.characters : wordTotal(counts);
    return t(unit === "characters" ? "counts.characters" : "counts.words", {
      count: value,
      formatted: number.format(value),
    });
  };

  async function guard(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      notify(
        t("history.failed", { message: e instanceof Error ? e.message : String(e) }),
        "warning",
      );
    } finally {
      setBusy(false);
    }
  }

  const takeSnapshot = (): void => {
    void guard(async () => {
      await editorBridge.flush();
      await currentSession().takeSnapshot(docId);
      reload();
    });
  };

  const restore = (): void => {
    if (!selected) return;
    void guard(async () => {
      const body = await currentSession().restoreSnapshot(docId, selected.path);
      editorBridge.replace(docId, body);
      setCurrent(body);
      notify(t("history.restored", { when: dateTime.format(new Date(selected.at)) }));
      reload();
      setSelected(null);
    });
  };

  const restoreAsCopy = (): void => {
    if (!selected) return;
    void guard(async () => {
      const newId = await currentSession().restoreSnapshotAsDocument(docId, selected.path);
      await openDocument(newId);
      onClose();
    });
  };

  const diff =
    snapshotBody !== null && current !== null
      ? diffParagraphs(paragraphsOf(snapshotBody), paragraphsOf(current))
      : null;

  return (
    <Dialog
      title={t("history.title", { title })}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className={styles.secondary} onClick={takeSnapshot} disabled={busy}>
            <Icon name="snapshot" size={15} />
            <span>{t("history.take")}</span>
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.secondary}
            onClick={restoreAsCopy}
            disabled={busy || !selected}
          >
            {t("history.restoreAsCopy")}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={restore}
            disabled={busy || !selected}
          >
            {t("history.restore")}
          </button>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.list}>
          {error !== null && <p className={styles.error}>{error}</p>}
          {snapshots === null && error === null && (
            <p className={styles.note}>{t("common.loading")}</p>
          )}
          {snapshots !== null && snapshots.length === 0 && (
            <p className={styles.note}>{t("history.empty")}</p>
          )}
          {snapshots?.map((snapshot) => (
            <button
              type="button"
              key={snapshot.path}
              className={styles.item}
              aria-pressed={selected?.path === snapshot.path}
              onClick={() => setSelected(snapshot)}
            >
              <span className={styles.when}>{dateTime.format(new Date(snapshot.at))}</span>
              <span className={styles.meta}>
                <span className={styles.kind} data-kind={snapshot.kind}>
                  {t(`history.kinds.${snapshot.kind}`)}
                </span>
                {snapshot.name !== undefined && <span>{snapshot.name}</span>}
                <span>{countLabel(snapshot.counts)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.diff}>
          {selected === null ? (
            <p className={styles.note}>{t("history.pick")}</p>
          ) : diff === null ? (
            <p className={styles.note}>{t("common.loading")}</p>
          ) : (
            <>
              <p className={styles.diffLegend}>
                {t("history.comparing", { when: dateTime.format(new Date(selected.at)) })}
              </p>
              <ParagraphDiffView diff={diff} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
