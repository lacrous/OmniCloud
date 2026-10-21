import { verifyVectors } from "./verify-vectors";

// The cross-client orchestrator polls globalThis.__OCL_VECTOR_REPORT__ (the
// browser global object) after loading this bundle in a real browser runtime.
void verifyVectors("browser").then((report) => {
  (globalThis as typeof globalThis & { __OCL_VECTOR_REPORT__?: unknown }).__OCL_VECTOR_REPORT__ =
    report;
});

export {};
