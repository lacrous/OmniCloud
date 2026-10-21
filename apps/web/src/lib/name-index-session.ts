import { useSyncExternalStore } from "react";
import type { FileDTO } from "@omnicloud/shared";
import type { IndexEntry } from "@omnicloud/crypto";

/**
 * The client's index of the file names the server cannot see.
 *
 * Kept as a module-level session, like the root key in `crypto-session`, so
 * every place that turns a file record into a drive item shows the name the
 * user knows the file by rather than the server's opaque placeholder.
 */

let entries: Map<string, IndexEntry> = new Map();
const listeners = new Set<() => void>();

/**
 * The account whose index has been loaded, so several hook instances share one
 * load. Without this, a component that mounts later would read the stored
 * index again and could overwrite an entry that was just added in memory.
 */
let loadedAccount: string | null = null;

/** True when this account's index still has to be read. */
export function shouldLoadIndex(accountId: string): boolean {
  return loadedAccount !== accountId;
}

/** Marks an account's index as loaded. */
export function markIndexLoaded(accountId: string): void {
  loadedAccount = accountId;
}

/** Forgets which account was loaded, so the next one is read afresh. */
export function forgetLoadedIndex(): void {
  loadedAccount = null;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The current index, keyed by file id. */
export function getNameIndex(): Map<string, IndexEntry> {
  return entries;
}

/** Replaces the index and tells anything bound to it. */
export function setNameIndex(next: Map<string, IndexEntry>): void {
  entries = next;
  notify();
}

/** Empties the index. */
export function clearNameIndex(): void {
  entries = new Map();
  notify();
}

/** Subscribes to index changes; returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: re-renders when the index changes. */
export function useNameIndexEntries(): Map<string, IndexEntry> {
  return useSyncExternalStore(subscribe, getNameIndex, getNameIndex);
}

/**
 * The real name of a file, when the index knows it.
 *
 * A file stored as OCE2 has an opaque placeholder as its server-side name; the
 * index holds the name the user knows it by. Anything else is unchanged, and a
 * file whose entry is missing keeps its placeholder, which is the honest thing
 * to show when the index has not been built yet.
 */
export function realNameOf(
  file: { id: string; name: string; encryptionFormat?: string | null },
  index: Map<string, IndexEntry> = entries,
): string {
  if (file.encryptionFormat !== "OCE2") return file.name;
  return index.get(file.id)?.name ?? file.name;
}

/** A file record with the real name substituted in. */
export function withRealName(file: FileDTO, index: Map<string, IndexEntry> = entries): FileDTO {
  const name = realNameOf(file, index);
  return name === file.name ? file : { ...file, name };
}

/**
 * A file record built from an index entry.
 *
 * The entry holds everything a search result needs to show: the name, the type,
 * the size and the dates. The server's own record for an OCE2 file carries an
 * opaque name, so a result found locally is rendered from the index instead.
 */
export function entryToFileDTO(entry: IndexEntry): FileDTO {
  return {
    id: entry.id,
    name: entry.name,
    size: entry.size,
    mimeType: entry.mimeType ?? "application/octet-stream",
    sha256: "",
    folderId: entry.folderId,
    starred: entry.starred,
    trashed: entry.trashed,
    deletedAt: entry.trashed ? entry.updatedAt : null,
    versionCount: entry.versionCount,
    currentVersionId: null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
