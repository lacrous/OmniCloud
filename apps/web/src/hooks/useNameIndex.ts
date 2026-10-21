import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createIndexContainer, openIndexContainer, type IndexEntry } from "@omnicloud/crypto";
import { useMe } from "./useMe";
import { useCryptoSession } from "../lib/crypto-session";
import {
  clearNameIndex,
  forgetLoadedIndex,
  getNameIndex,
  markIndexLoaded,
  setNameIndex,
  shouldLoadIndex,
  useNameIndexEntries,
} from "../lib/name-index-session";
import {
  deleteIndexBytes,
  isNameIndexStoreAvailable,
  readIndexBytes,
  writeIndexBytes,
} from "../lib/name-index-store";

export interface NameIndexController {
  /** The entries, keyed by file id. */
  entries: Map<string, IndexEntry>;
  /** True once the stored index has been read (or found to be absent). */
  ready: boolean;
  /** Adds or replaces an entry and persists the index. */
  upsert: (entry: IndexEntry) => void;
  /** Removes an entry and persists the index. */
  remove: (fileId: string) => void;
  /** Empties the index and deletes the stored container. */
  clear: () => void;
}

/**
 * Keeps the client's index of the file names the server cannot see.
 *
 * The index is held for the tab and stored in the browser as an encrypted
 * container. It can only be opened while the root key is loaded, so with no
 * key the client has no names to show: the files are still listed, under their
 * opaque placeholders.
 */
export function useNameIndex(): NameIndexController {
  const me = useMe();
  const accountId = me.data?.user?.id ?? null;
  const urk = useCryptoSession();
  const entries = useNameIndexEntries();
  const [ready, setReady] = useState(false);
  // The account the loaded index belongs to, so a sign-out does not leave one
  // account's names visible to the next.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (accountId === null || urk === null) {
      clearNameIndex();
      forgetLoadedIndex();
      setReady(accountId === null);
      loadedFor.current = null;
      return;
    }
    // Several components use this hook; only the first one reads the stored
    // index, so a later component cannot overwrite an entry that was just
    // added in memory.
    if (loadedFor.current === accountId || !shouldLoadIndex(accountId)) return;
    loadedFor.current = accountId;
    markIndexLoaded(accountId);
    setReady(false);
    void (async () => {
      const bytes = await readIndexBytes(accountId);
      if (cancelled) return;
      let loaded = new Map<string, IndexEntry>();
      if (bytes !== null) {
        try {
          for (const entry of openIndexContainer(urk, bytes)) loaded.set(entry.id, entry);
        } catch {
          // A container that will not open is treated as no index: the client
          // rebuilds it from the server rather than showing a wrong name.
          loaded = new Map();
        }
      }
      if (cancelled) return;
      setNameIndex(loaded);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, urk]);

  const persist = useCallback(
    (next: Map<string, IndexEntry>) => {
      if (accountId === null || urk === null) return;
      void writeIndexBytes(accountId, createIndexContainer(urk, [...next.values()])).catch(() => {
        // The index is derived data; failing to store it costs a rebuild.
      });
    },
    [accountId, urk],
  );

  const upsert = useCallback(
    (entry: IndexEntry) => {
      const next = new Map(getNameIndex());
      next.set(entry.id, entry);
      setNameIndex(next);
      persist(next);
    },
    [persist],
  );

  const remove = useCallback(
    (fileId: string) => {
      const current = getNameIndex();
      if (!current.has(fileId)) return;
      const next = new Map(current);
      next.delete(fileId);
      setNameIndex(next);
      persist(next);
    },
    [persist],
  );

  const clear = useCallback(() => {
    clearNameIndex();
    if (accountId !== null) void deleteIndexBytes(accountId);
  }, [accountId]);

  // The controller object is memoized so it can be used as a hook dependency
  // without re-creating the callbacks that depend on it.
  return useMemo(
    () => ({ entries, ready, upsert, remove, clear }),
    [entries, ready, upsert, remove, clear],
  );
}

/** True when the browser can hold the index at all. */
export { isNameIndexStoreAvailable };
