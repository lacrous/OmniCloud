/**
 * Where the encrypted name index lives in the browser.
 *
 * The index is stored as the container's bytes — already encrypted with a key
 * derived from the user's root key — so a copy of the browser profile reveals
 * nothing on its own. One record per account.
 *
 * IndexedDB is used rather than localStorage because the container is binary
 * and because localStorage is readable by any script on the page, which is the
 * same exposure the encrypted form is designed to remove.
 */

const DB_NAME = "omnicloud-name-index";
const DB_VERSION = 1;
const STORE = "indexes";

/** True when this browser can store the index at all. */
export function isNameIndexStoreAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the index store"));
    request.onblocked = () => reject(new Error("the index store is blocked by another tab"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("the index store failed"));
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => db.close();
      }),
  );
}

/** The stored container for an account, or null when there is none. */
export async function readIndexBytes(accountId: string): Promise<Uint8Array | null> {
  if (!isNameIndexStoreAvailable()) return null;
  try {
    const value = await run<unknown>("readonly", (store) => store.get(accountId));
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    return null;
  } catch {
    // A store that cannot be read is treated as an empty index: the client
    // rebuilds it from the server rather than failing.
    return null;
  }
}

/** Stores the container for an account. */
export async function writeIndexBytes(accountId: string, bytes: Uint8Array): Promise<void> {
  if (!isNameIndexStoreAvailable()) return;
  const copy = bytes.slice();
  await run("readwrite", (store) => store.put(copy, accountId));
}

/** Removes the container for an account. */
export async function deleteIndexBytes(accountId: string): Promise<void> {
  if (!isNameIndexStoreAvailable()) return;
  try {
    await run("readwrite", (store) => store.delete(accountId));
  } catch {
    // Nothing to do: the index is derived data and can be rebuilt.
  }
}
