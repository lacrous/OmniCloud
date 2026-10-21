import { sha256 } from "@noble/hashes/sha256";

/** SHA-256 of bytes as lowercase hex — shared by migration verification. */
export function sha256Hex(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}
