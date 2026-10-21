/**
 * Regenerates the committed OCE1 v1 known-answer vector.
 *
 * This is deliberately a separate, explicit step. The vector test refuses to
 * create the file on its own: if the crypto produced different bytes, a test
 * that wrote them out would define the broken output as the new baseline and
 * pass. Regenerating is a decision to accept a change to the protocol, so it
 * gets its own command and its own diff to review.
 *
 * Usage: pnpm --filter @omnicloud/crypto vectors:write
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildVector } from "./vector-source";

const VECTOR_PATH = fileURLToPath(new URL("../test/vectors/v1.json", import.meta.url));

const vector = await buildVector();
writeFileSync(VECTOR_PATH, `${JSON.stringify(vector, null, 2)}\n`);
console.log(`wrote ${VECTOR_PATH}`);
console.log(
  "Review the diff before committing: a change here is a change to the protocol baseline.",
);
