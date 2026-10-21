import { generateUrk } from "@omnicloud/crypto";
import { useSyncExternalStore } from "react";

/**
 * In-memory OCE1 user root key (URK) session. The key lives in memory only
 * for this tab's session — it is never written to localStorage, IndexedDB,
 * cookies or any other storage — so a reload requires unlocking it again.
 */

let urk: Uint8Array | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The active URK, or null when no key is loaded. */
export function getUrk(): Uint8Array | null {
  return urk;
}

/** Generates a fresh URK, stores it for this tab, and returns it. */
export function generate(): Uint8Array {
  const key = generateUrk();
  urk = key;
  notify();
  return key;
}

/** Loads a URK from a 64-character hex string. Throws if the format is wrong. */
export function unlockFromHex(hex: string): void {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("The key must be exactly 64 hexadecimal characters");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  urk = bytes;
  notify();
}

/** Drops the key from memory for this tab. */
export function clear(): void {
  urk = null;
  notify();
}

/** Subscribes to key changes; returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: re-renders when the key is generated, unlocked or cleared. */
export function useCryptoSession(): Uint8Array | null {
  return useSyncExternalStore(subscribe, getUrk, getUrk);
}

/** Lowercase hex rendering of key bytes (for the one-time reveal). */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Separate opt-in preference: encrypt new uploads. Unlike the URK this
 * boolean MAY be persisted — it carries no secret.
 */
export const ENCRYPT_UPLOADS_KEY = "omnicloud-encrypt-uploads";

export type EncryptUploadsPref = "on" | "off";

export function isEncryptUploadsPref(value: string): value is EncryptUploadsPref {
  return value === "on" || value === "off";
}

/** Reads the persisted preference at upload time (source of truth for uploads). */
export function isEncryptUploadsEnabled(): boolean {
  try {
    return localStorage.getItem(ENCRYPT_UPLOADS_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * Which encrypted format new uploads are stored in.
 *
 * `OCE1` leaves the file's name visible to the server. `OCE2` hides it: the
 * server stores an opaque placeholder and the real name lives only in this
 * client's index. OCE1 is the default until the format has been reviewed.
 *
 * Like the preference above, this carries no secret, so it may be persisted.
 */
export const ENCRYPT_FORMAT_KEY = "omnicloud-encrypt-format";

export type EncryptFormatPref = "OCE1" | "OCE2";

export function isEncryptFormatPref(value: string): value is EncryptFormatPref {
  return value === "OCE1" || value === "OCE2";
}

/** Reads the persisted format preference; defaults to OCE1. */
export function encryptFormatPref(): EncryptFormatPref {
  try {
    const stored = localStorage.getItem(ENCRYPT_FORMAT_KEY);
    return stored !== null && isEncryptFormatPref(stored) ? stored : "OCE1";
  } catch {
    return "OCE1";
  }
}

/** Persists the format preference. */
export function setEncryptFormatPref(format: EncryptFormatPref): void {
  try {
    localStorage.setItem(ENCRYPT_FORMAT_KEY, format);
  } catch {
    // A preference that cannot be stored simply does not persist.
  }
}
