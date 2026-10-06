import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FileDTO, FolderDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { invalidateDriveQueries, TREE_QUERY_KEY } from "../lib/queries";
import { buildFolderTree, subtreeFolderIds } from "../lib/tree";
import type { FolderNode } from "../lib/tree";
import { ChevronDownIcon, FolderIcon } from "./icons";
import { Modal } from "./Modal";
import { useToast } from "./Toasts";

export type MoveTarget = { kind: "file"; file: FileDTO } | { kind: "folder"; folder: FolderDTO };

function currentParentOf(target: MoveTarget): string | null {
  return target.kind === "file" ? target.file.folderId : target.folder.parentId;
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
              className="flex items-center gap-1 rounded-md pr-2 hover:bg-gray-50"
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
                  className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                >
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <span className="w-[1.125rem] shrink-0" aria-hidden="true" />
              )}
              <label
                className={`flex min-w-0 flex-1 items-center gap-2 py-1 text-sm ${
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
                  className="accent-indigo-600"
                />
                <FolderIcon className="h-4 w-4 shrink-0 text-indigo-500" />
                <span className={`truncate ${disabled ? "text-gray-300" : "text-gray-700"}`}>
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
  target: MoveTarget;
  onClose: () => void;
}

/** Move a file or folder to another location, shown as a collapsible folder tree. */
export function MoveDialog({ target, onClose }: MoveDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const treeQuery = useQuery({ queryKey: TREE_QUERY_KEY, queryFn: api.folders.tree });
  const tree = useMemo(() => buildFolderTree(treeQuery.data?.folders ?? []), [treeQuery.data]);

  const [selectedId, setSelectedId] = useState<string | null>(() => currentParentOf(target));
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());

  const currentParent = currentParentOf(target);
  const itemName = target.kind === "file" ? target.file.name : target.folder.name;

  const disabledIds = useMemo(() => {
    if (target.kind !== "folder") return new Set<string>();
    return new Set(subtreeFolderIds(tree, target.folder.id));
  }, [tree, target]);

  const moveMutation = useMutation({
    mutationFn: (): Promise<{ file: FileDTO } | { folder: FolderDTO }> => {
      if (target.kind === "file") return api.files.move(target.file.id, selectedId);
      return api.folders.move(target.folder.id, selectedId);
    },
    onSuccess: () => {
      invalidateDriveQueries(queryClient);
      toast.success(`Moved "${itemName}"`);
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, "Could not move item")),
  });

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Modal title={`Move "${itemName}"`} onClose={onClose}>
      <p className="text-sm text-gray-500">Choose a destination folder.</p>
      <fieldset
        aria-label="Destination folder"
        className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-gray-200 p-2"
      >
        <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
          <input
            type="radio"
            name="move-target"
            checked={selectedId === null}
            onChange={() => setSelectedId(null)}
            className="accent-indigo-600"
          />
          <FolderIcon className="h-4 w-4 shrink-0 text-indigo-500" />
          <span className="text-gray-700">My Drive (root)</span>
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
      {treeQuery.isPending ? <p className="mt-2 text-sm text-gray-500">Loading folders…</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className="oc-btn-secondary"
          onClick={onClose}
          disabled={moveMutation.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="oc-btn-primary"
          disabled={selectedId === currentParent || moveMutation.isPending}
          onClick={() => moveMutation.mutate()}
        >
          {moveMutation.isPending ? "Moving…" : "Move"}
        </button>
      </div>
    </Modal>
  );
}
