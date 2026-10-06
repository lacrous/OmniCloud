import type { FolderDTO } from "@omnicloud/shared";

export interface FolderNode {
  folder: FolderDTO;
  children: FolderNode[];
}

/** Builds a sorted hierarchy from a flat folder list. Orphaned folders become roots. */
export function buildFolderTree(folders: FolderDTO[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const folder of folders) {
    nodes.set(folder.id, { folder, children: [] });
  }

  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.folder.parentId === null ? undefined : nodes.get(node.folder.parentId);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  const sortRecursive = (list: FolderNode[]): FolderNode[] => {
    list.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    for (const node of list) sortRecursive(node.children);
    return list;
  };
  return sortRecursive(roots);
}

/** Depth-first search for a folder by id. */
export function findFolder(nodes: FolderNode[], id: string): FolderDTO | null {
  for (const node of nodes) {
    if (node.folder.id === id) return node.folder;
    const found = findFolder(node.children, id);
    if (found !== null) return found;
  }
  return null;
}

/** Returns the path from the root down to `folderId` (empty when unknown). */
export function breadcrumbPath(nodes: FolderNode[], folderId: string | null): FolderDTO[] {
  if (folderId === null) return [];
  const path: FolderDTO[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = findFolder(nodes, currentId);
    if (folder === null) break;
    path.unshift(folder);
    currentId = folder.parentId;
  }
  return path;
}

/** Returns the ids of `rootId` and all its descendants (guarding against cycles). */
export function subtreeFolderIds(nodes: FolderNode[], rootId: string): string[] {
  const ids: string[] = [];
  const visit = (node: FolderNode): void => {
    ids.push(node.folder.id);
    for (const child of node.children) visit(child);
  };
  const findAndVisit = (list: FolderNode[]): boolean => {
    for (const node of list) {
      if (node.folder.id === rootId) {
        visit(node);
        return true;
      }
      if (findAndVisit(node.children)) return true;
    }
    return false;
  };
  findAndVisit(nodes);
  return ids;
}
