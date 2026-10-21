/**
 * The OCE2 opaque name: the placeholder the server stores instead of a real
 * file name.
 *
 * It lives here rather than in the crypto package because the server has to
 * check it — an upload that claims to be OCE2 must actually carry an opaque
 * name, or a client could leak the real name while claiming not to. The server
 * depends on this package and not on the crypto one, because the server never
 * interprets anything cryptographic.
 *
 * Normative detail lives in docs/security/encryption-protocol-v2.md.
 */

/** The prefix every opaque name carries. */
export const OPAQUE_NAME_PREFIX = "om_";
/** Random bytes behind an opaque name. */
export const OPAQUE_NAME_BYTES = 16;

/**
 * A name for the server to store: a prefix and 16 random bytes.
 *
 * The bytes are random rather than derived from the file, so two uploads of
 * the same content get unrelated placeholders and the server cannot tell that
 * two accounts hold the same file.
 */
export function generateOpaqueName(random?: Uint8Array): string {
  const bytes = random ?? platformRandomBytes(OPAQUE_NAME_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.length !== OPAQUE_NAME_BYTES) {
    throw new Error(`opaque name needs ${OPAQUE_NAME_BYTES} random bytes`);
  }
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${OPAQUE_NAME_PREFIX}${hex}`;
}

/** True when a name is one a client generated as an opaque name. */
export function isOpaqueName(name: string): boolean {
  if (typeof name !== "string" || !name.startsWith(OPAQUE_NAME_PREFIX)) return false;
  const hex = name.slice(OPAQUE_NAME_PREFIX.length);
  return hex.length === OPAQUE_NAME_BYTES * 2 && /^[0-9a-f]+$/.test(hex);
}

/** Random bytes from the platform's CSPRNG, which both browsers and Node have. */
function platformRandomBytes(length: number): Uint8Array {
  const source = globalThis.crypto;
  if (source === undefined || typeof source.getRandomValues !== "function") {
    throw new Error("this runtime has no cryptographic random source");
  }
  return source.getRandomValues(new Uint8Array(length));
}
