/**
 * Browser half of the M5 web streaming benchmark (plan item 1).
 *
 * Runs `encryptFileStreaming` from the real web module inside a real browser
 * runtime, over a large synthetic `File`, and reports what the SDK-side
 * evidence (`docs/evidence/streaming-memory.md`) could not cover: the browser
 * chunked path, including whether the test browser actually provides OPFS.
 *
 * The orchestrator (`bench-web-streaming.mjs`) polls
 * `globalThis.__OCL_WEB_BENCH__` after loading this bundle.
 */
import { generateUrk } from "@omnicloud/crypto";
import {
  encryptFileStreaming,
  STREAM_MIN_BYTES,
  BUFFERED_MAX_BYTES,
} from "../src/api/encrypt-stream";

const MiB = 1024 * 1024;

interface PhaseResult {
  sizeMiB: number;
  ms: number;
  mibPerSec: number;
  /** Envelope size in bytes as reported by the Blob the caller received. */
  envelopeBytes: number;
  /** First 4 bytes of the envelope, decoded — must be the OCE1 magic. */
  magic: string;
  /** Whether the OCE1 magic is present. */
  envelopeLooksEncrypted: boolean;
  opfsAvailable: boolean;
  /** Peak JS heap seen during the phase, in MiB. */
  peakHeapMiB: number;
  error?: string;
}

/** Builds `sizeMiB` of patterned bytes as a real File, without a giant literal. */
function syntheticFile(sizeMiB: number): File {
  const size = sizeMiB * MiB;
  const parts: BlobPart[] = [];
  const block = new Uint8Array(MiB);
  let seed = 7;
  for (let written = 0; written < size; written += MiB) {
    for (let i = 0; i < block.length; i++) block[i] = (i * 31 + seed) & 0xff;
    parts.push(block.slice().buffer as ArrayBuffer);
    seed = (seed + 13) & 0xff;
  }
  return new File(parts, "bench.bin", { type: "application/octet-stream" });
}

function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

function heapMiB(): number {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  return perf.memory ? Math.round((perf.memory.usedJSHeapSize / MiB) * 10) / 10 : -1;
}

async function runPhase(sizeMiB: number): Promise<PhaseResult> {
  const file = syntheticFile(sizeMiB);
  const urk = generateUrk();
  const started = performance.now();
  let peakHeap = heapMiB();
  const sampler = setInterval(() => {
    const h = heapMiB();
    if (h > peakHeap) peakHeap = h;
  }, 50);

  try {
    const streamed = await encryptFileStreaming(file, urk);
    const ms = performance.now() - started;
    clearInterval(sampler);

    const head = new Uint8Array(await streamed.envelope.slice(0, 4).arrayBuffer());
    const magic = String.fromCharCode(...head);
    const result: PhaseResult = {
      sizeMiB,
      ms: Math.round(ms),
      mibPerSec: Math.round((sizeMiB / (ms / 1000)) * 10) / 10,
      envelopeBytes: streamed.envelope.size,
      magic,
      envelopeLooksEncrypted: magic === "OCE1",
      opfsAvailable: opfsAvailable(),
      peakHeapMiB: peakHeap,
    };
    // Leave no spool behind in the test browser.
    await streamed.dispose();
    return result;
  } catch (error) {
    clearInterval(sampler);
    return {
      sizeMiB,
      ms: Math.round(performance.now() - started),
      mibPerSec: 0,
      envelopeBytes: 0,
      magic: "",
      envelopeLooksEncrypted: false,
      opfsAvailable: opfsAvailable(),
      peakHeapMiB: peakHeap,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface BenchReport {
  pass: boolean;
  runtime: string;
  streamMinBytes: number;
  bufferedMaxBytes: number;
  userAgent: string;
  phases: PhaseResult[];
}

async function runBench(): Promise<BenchReport> {
  const sizes = (globalThis as { __OCL_BENCH_SIZES__?: number[] }).__OCL_BENCH_SIZES__ ?? [32, 256];
  const phases: PhaseResult[] = [];
  for (const size of sizes) phases.push(await runPhase(size));

  // Pass requires every phase to complete, produce an OCE1 envelope, and stay
  // under the buffered-fallback ceiling declared by the module.
  const pass = phases.every(
    (p) =>
      !p.error &&
      p.envelopeLooksEncrypted &&
      p.envelopeBytes > 0 &&
      p.sizeMiB * MiB <= BUFFERED_MAX_BYTES,
  );

  return {
    pass,
    runtime: "browser",
    streamMinBytes: STREAM_MIN_BYTES,
    bufferedMaxBytes: BUFFERED_MAX_BYTES,
    userAgent: navigator.userAgent,
    phases,
  };
}

void runBench().then((report) => {
  (globalThis as typeof globalThis & { __OCL_WEB_BENCH__?: unknown }).__OCL_WEB_BENCH__ = report;
});

export {};
