import { isRootId, ROOT_IDS, rootOf, type RootId, type TreeNode } from "@sheaf/core";
import { useMemo, useState, type KeyboardEvent } from "react";
import {
  Button,
  Collection,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop,
  type Key,
  type Selection,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../components/Icon";
import { editorBridge } from "../editor/bridge";
import { useAppStore } from "../state/app-store";
import {
  createItem,
  indent,
  moveDown,
  moveItems,
  moveUp,
  outdent,
  restoreItems,
  trashItems,
} from "./binder-actions";
import styles from "./Binder.module.css";

interface Item {
  id: string;
  title: string;
  kind: "root" | "text" | "folder";
  root: RootId;
  children: Item[];
}

const ROOT_ICONS: Record<RootId, IconName> = {
  manuscript: "manuscript",
  research: "research",
  trash: "trash",
};

type ItemAction =
  | "open"
  | "rename"
  | "newDocument"
  | "newFolder"
  | "moveUp"
  | "moveDown"
  | "indent"
  | "outdent"
  | "trash"
  | "restore";

/** Alt+Shift+Arrow moves the selected item (like outliners and Scrivener's binder). */
const MOVE_KEYS: Readonly<Record<string, ItemAction>> = {
  ArrowUp: "moveUp",
  ArrowDown: "moveDown",
  ArrowRight: "indent",
  ArrowLeft: "outdent",
};

export function Binder({ onOpened }: { onOpened?: () => void }) {
  const { t } = useTranslation();
  const snapshot = useAppStore((s) => s.snapshot);
  const selection = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  const openDocument = useAppStore((s) => s.openDocument);

  const items = useMemo<Item[]>(() => {
    if (!snapshot) return [];
    const untitled = t("session.untitled");
    const convert = (node: TreeNode, root: RootId): Item => ({
      id: node.id,
      title: node.meta.title || untitled,
      kind: node.meta.kind,
      root,
      children: node.children.map((c) => convert(c, root)),
    });
    return ROOT_IDS.map((root) => ({
      id: root,
      title: snapshot.project.roots[root],
      kind: "root" as const,
      root,
      children: snapshot.tree.roots[root].map((n) => convert(n, root)),
    }));
  }, [snapshot, t]);

  const [expanded, setExpanded] = useState<Set<Key>>(() => {
    const keys = new Set<Key>(["manuscript", "research"]);
    for (const node of snapshot?.tree.nodes.values() ?? [])
      if (node.children.length > 0) keys.add(node.id);
    return keys;
  });

  const titleOf = (id: string): string => snapshot?.docs.get(id)?.meta.title ?? id;

  const { dragAndDropHooks } = useDragAndDrop<Item>({
    getItems: (keys) =>
      [...keys]
        .filter((k) => !isRootId(String(k)))
        .map((k) => ({ "text/plain": titleOf(String(k)) })),
    getAllowedDropOperations: () => ["move"],
    // Roots accept drops "on" them, never beside them.
    getDropOperation: (target) =>
      target.type === "item" && isRootId(String(target.key)) && target.dropPosition !== "on"
        ? "cancel"
        : "move",
    onMove: (e) => {
      const ids = [...e.keys].map(String).filter((k) => !isRootId(k));
      if (ids.length === 0) return;
      const position = e.target.dropPosition === "on" ? "into" : e.target.dropPosition;
      const target = String(e.target.key);
      if (position === "into") setExpanded((prev) => new Set(prev).add(target));
      void moveItems(ids, target, position);
    },
  });

  function onSelectionChange(keys: Selection): void {
    const ids = keys === "all" ? [] : [...keys].map(String).filter((k) => !isRootId(k));
    setSelection(ids);
    if (ids.length === 1 && ids[0]) {
      void openDocument(ids[0]);
      onOpened?.();
    }
  }

  function runAction(action: ItemAction, id: string): void {
    switch (action) {
      case "open":
        setSelection([id]);
        void openDocument(id);
        onOpened?.();
        break;
      case "rename":
        setSelection([id]);
        void openDocument(id).then(() => editorBridge.focusTitle());
        onOpened?.();
        break;
      case "newDocument":
      case "newFolder":
        if (snapshot?.docs.get(id)?.meta.kind === "folder" || isRootId(id))
          setExpanded((p) => new Set(p).add(id));
        void createItem(action === "newFolder" ? "folder" : "text", id).then(() => onOpened?.());
        break;
      case "moveUp":
        void moveUp(id);
        break;
      case "moveDown":
        void moveDown(id);
        break;
      case "indent": {
        // Show the item in its new place: open the item it moves into.
        const parent = snapshot?.tree.displayParent.get(id);
        const siblings = parent
          ? isRootId(parent)
            ? snapshot?.tree.roots[parent]
            : snapshot?.tree.nodes.get(parent)?.children
          : undefined;
        const index = siblings?.findIndex((n) => n.id === id) ?? -1;
        const above = index > 0 ? siblings?.[index - 1]?.id : undefined;
        if (above) setExpanded((p) => new Set(p).add(above));
        void indent(id);
        break;
      }
      case "outdent":
        void outdent(id);
        break;
      case "trash":
        void trashItems(selection.includes(id) ? selection : [id]);
        break;
      case "restore":
        void restoreItems(selection.includes(id) ? selection : [id]);
        break;
    }
  }

  // Keyboard: Delete → Trash; Alt+Shift+Arrows → move up/down/in/out.
  // Captured before the tree so its own arrow-key navigation doesn't run.
  function onKeyDownCapture(e: KeyboardEvent<HTMLDivElement>): void {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable]")) return;
    const focusedId = target.closest<HTMLElement>("[data-key]")?.dataset["key"];
    const ids =
      selection.length > 0 ? selection : focusedId && !isRootId(focusedId) ? [focusedId] : [];
    if ((e.key === "Delete" || e.key === "Backspace") && ids.length > 0 && snapshot) {
      e.preventDefault();
      e.stopPropagation();
      const inTrash = ids.every((id) => rootOf(snapshot.tree, id) === "trash");
      if (!inTrash) void trashItems(ids);
      return;
    }
    const id = ids.length === 1 ? ids[0] : undefined;
    if (!(e.altKey && e.shiftKey) || !id) return;
    const action = MOVE_KEYS[e.key];
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      runAction(action, id);
    }
  }

  const primary = selection[selection.length - 1] ?? null;

  return (
    <div className={styles.binder} onKeyDownCapture={onKeyDownCapture}>
      <div className={styles.header}>
        <h2 className={styles.heading}>{t("binder.label")}</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("binder.newDocument")}
          title={t("binder.newDocument")}
          onClick={() => void createItem("text", primary).then(() => onOpened?.())}
        >
          <Icon name="plusDocument" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("binder.newFolder")}
          title={t("binder.newFolder")}
          onClick={() => void createItem("folder", primary).then(() => onOpened?.())}
        >
          <Icon name="plusFolder" />
        </button>
      </div>

      <Tree
        aria-label={t("binder.label")}
        className={styles.tree ?? ""}
        items={items}
        selectionMode="multiple"
        selectionBehavior="replace"
        selectedKeys={new Set(selection)}
        onSelectionChange={onSelectionChange}
        disabledKeys={ROOT_IDS}
        disabledBehavior="selection"
        expandedKeys={expanded}
        onExpandedChange={setExpanded}
        dragAndDropHooks={dragAndDropHooks}
      >
        {function renderItem(item: Item) {
          return (
            <TreeItem
              id={item.id}
              textValue={item.title}
              className={styles.item ?? ""}
              data-kind={item.kind}
            >
              <TreeItemContent>
                {({ hasChildItems, isExpanded, level }) => (
                  <div
                    className={styles.row}
                    style={{ paddingInlineStart: `${(level - 1) * 14 + 4}px` }}
                  >
                    {/* Keyboard and screen-reader drag handle (visible on focus). */}
                    <Button
                      slot="drag"
                      className={styles.dragHandle ?? ""}
                      aria-label={t("binder.dragHandle", { title: item.title })}
                      isDisabled={item.kind === "root"}
                    >
                      <Icon name="more" size={12} />
                    </Button>
                    {hasChildItems ? (
                      <Button
                        slot="chevron"
                        className={styles.chevron ?? ""}
                        data-expanded={isExpanded}
                      >
                        <Icon name="chevron" size={14} />
                      </Button>
                    ) : (
                      <span className={styles.chevronSpacer} />
                    )}
                    <span className={styles.kindIcon}>
                      <Icon
                        name={
                          item.kind === "root"
                            ? ROOT_ICONS[item.root]
                            : item.kind === "folder"
                              ? "folder"
                              : "document"
                        }
                        size={16}
                      />
                    </span>
                    <span className={styles.title}>{item.title}</span>
                    {item.kind === "root" && item.root === "trash" && item.children.length > 0 && (
                      <span className={styles.count}>{item.children.length}</span>
                    )}
                    <ItemMenu item={item} onAction={runAction} />
                  </div>
                )}
              </TreeItemContent>
              <Collection items={item.children}>{renderItem}</Collection>
            </TreeItem>
          );
        }}
      </Tree>
    </div>
  );
}

function ItemMenu({
  item,
  onAction,
}: {
  item: Item;
  onAction: (action: ItemAction, id: string) => void;
}) {
  const { t } = useTranslation();
  const inTrash = item.root === "trash";
  const entries: { id: ItemAction; icon: IconName; label: string }[] =
    item.kind === "root"
      ? item.root === "trash"
        ? []
        : [
            { id: "newDocument", icon: "plusDocument", label: t("binder.newDocument") },
            { id: "newFolder", icon: "plusFolder", label: t("binder.newFolder") },
          ]
      : inTrash
        ? [
            { id: "open", icon: "open", label: t("binder.open") },
            { id: "restore", icon: "restore", label: t("binder.restore") },
          ]
        : [
            { id: "open", icon: "open", label: t("binder.open") },
            { id: "rename", icon: "rename", label: t("binder.rename") },
            { id: "newDocument", icon: "plusDocument", label: t("binder.newDocumentHere") },
            { id: "newFolder", icon: "plusFolder", label: t("binder.newFolderHere") },
            { id: "moveUp", icon: "up", label: t("binder.moveUp") },
            { id: "moveDown", icon: "down", label: t("binder.moveDown") },
            { id: "indent", icon: "indent", label: t("binder.indent") },
            { id: "outdent", icon: "outdent", label: t("binder.outdent") },
            { id: "trash", icon: "trash", label: t("binder.trash") },
          ];
  if (entries.length === 0) return null;
  return (
    <MenuTrigger>
      <Button
        className={styles.more ?? ""}
        aria-label={t("binder.itemMenu", { title: item.title })}
      >
        <Icon name="more" size={16} />
      </Button>
      <Popover className={styles.popover ?? ""} placement="bottom end">
        <Menu
          className={styles.menu ?? ""}
          onAction={(key) => onAction(key as ItemAction, item.id)}
        >
          {entries.map((entry) => (
            <MenuItem
              key={entry.id}
              id={entry.id}
              className={styles.menuItem ?? ""}
              textValue={entry.label}
            >
              <Icon name={entry.icon} size={16} />
              <span>{entry.label}</span>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
