import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Folder, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../api/client";
import { invalidateDriveQueries, TREE_QUERY_KEY } from "../lib/queries";
import { buildFolderTree, subtreeFolderIds } from "../lib/tree";
import type { FolderNode } from "../lib/tree";
import type { DriveItem } from "../lib/drive";
import { Modal } from "./Modal";
import { useToast } from "./Toasts";

function currentParentOf(item: DriveItem): string | null {
  return item.kind === "file" ? (item.file?.folderId ?? null) : (item.folder?.parentId ?? null);
}

interface TreeLevelProps {
  nodes: FolderNode[];
  depth: number;
  groupName: string;
  selectedId: string | null;
  disabledIds: ReadonlySet<string>;
  collapsedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string | null) => void;
}

function TreeLevel({
  nodes,
  depth,
  groupName,
  selectedId,
  disabledIds,
  collapsedIds,
  onToggle,
  onSelect,
}: TreeLevelProps) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const id = node.folder.id;
        const disabled = disabledIds.has(id);
        const hasChildren = node.children.length > 0;
        const collapsed = collapsedIds.has(id);
        return (
          <li key={id}>
            <div
              className={`flex items-center gap-1 rounded-lg pr-2 transition-colors ${
                disabled ? "" : "hover:bg-surface"
              }`}
              style={{ paddingLeft: `${depth * 1.25 + 0.375}rem` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={
                    collapsed ? `Expand ${node.folder.name}` : `Collapse ${node.folder.name}`
                  }
                  aria-expanded={!collapsed}
                  onClick={() => onToggle(id)}
                  className="muted shrink-0 rounded p-0.5 transition-colors hover:text-gold-text"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <span className="w-[1.125rem] shrink-0" aria-hidden="true" />
              )}
              <label
                className={`flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-sm ${
                  disabled ? "cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={id}
                  checked={selectedId === id}
                  disabled={disabled}
                  onChange={() => onSelect(id)}
                  className="h-3.5 w-3.5"
                  style={{ accentColor: "var(--gold)" }}
                />
                <Folder
                  className={`h-4 w-4 shrink-0 ${disabled ? "muted" : "text-gold"}`}
                  aria-hidden="true"
                />
                <span className={`min-w-0 truncate ${disabled ? "muted opacity-60" : ""}`}>
                  {node.folder.name}
                </span>
              </label>
            </div>
            {hasChildren && !collapsed ? (
              <TreeLevel
                nodes={node.children}
                depth={depth + 1}
                groupName={groupName}
                selectedId={selectedId}
                disabledIds={disabledIds}
                collapsedIds={collapsedIds}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface MoveDialogProps {
  targets: DriveItem[];
  onClose: () => void;
  onMoved?: () => void;
}

/** Move one or more files/folders to another location, shown as a folder tree. */
export function MoveDialog({ targets, onClose, onMoved }: MoveDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const treeQuery = useQuery({ queryKey: TREE_QUERY_KEY, queryFn: api.folders.tree });
  const tree = useMemo(() => buildFolderTree(treeQuery.data?.folders ?? []), [treeQuery.data]);

  const first = targets[0];
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    first === undefined ? null : currentParentOf(first),
  );
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());

  const itemName =
    targets.length === 1 && first !== undefined ? `"${first.name}"` : `${targets.length} items`;

  const disabledIds = useMemo(() => {
    const ids = new Set<string>();
    for (const target of targets) {
      if (target.kind === "folder") {
        for (const id of subtreeFolderIds(tree, target.folder?.id ?? target.id)) ids.add(id);
      }
    }
    return ids;
  }, [tree, targets]);

  const moveMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await Promise.all(
        targets.map((target) =>
          target.kind === "file"
            ? api.files.move(target.id, selectedId)
            : api.folders.move(target.id, selectedId),
        ),
      );
    },
    onSuccess: () => {
      invalidateDriveQueries(queryClient);
      toast.success(`Moved ${itemName}`);
      onMoved?.();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, "Could not move item")),
  });

  const unchanged = targets.every((target) => currentParentOf(target) === selectedId);

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal title={`Move ${itemName}`} onClose={onClose}>
      <p className="muted text-[13px]">Choose a destination folder.</p>
      <fieldset
        aria-label="Destination folder"
        className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-line bg-bg-soft p-2"
      >
        <label
          className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
            selectedId === null ? "bg-surface" : "hover:bg-surface"
          }`}
        >
          <input
            type="radio"
            name="move-target"
            checked={selectedId === null}
            onChange={() => setSelectedId(null)}
            className="h-3.5 w-3.5"
            style={{ accentColor: "var(--gold)" }}
          />
          <Folder className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <span>My Drive (root)</span>
        </label>
        <TreeLevel
          nodes={tree}
          depth={0}
          groupName="move-target"
          selectedId={selectedId}
          disabledIds={disabledIds}
          collapsedIds={collapsedIds}
          onToggle={toggleCollapsed}
          onSelect={setSelectedId}
        />
      </fieldset>
      {treeQuery.isPending ? <p className="muted mt-2 text-[13px]">Loading folders...</p> : null}
      <div className="mt-5 flex justify-end gap-2.5">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={moveMutation.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-gold"
          disabled={unchanged || moveMutation.isPending}
          onClick={() => moveMutation.mutate()}
        >
          {moveMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {moveMutation.isPending ? "Moving..." : "Move"}
        </button>
      </div>
    </Modal>
  );
}
