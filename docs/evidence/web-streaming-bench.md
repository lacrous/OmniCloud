# Web streaming E2EE benchmark (M5 item 1)

Browser evidence for the web chunked-encryption path
(`apps/web/src/api/encrypt-stream.ts`), matching the evidence standard already
applied to the SDK path in `streaming-memory.md`.

## Result

Headless Firefox 158, via geckodriver, on Linux. Orchestrator:
`apps/web/scripts/bench-web-streaming.mjs` (esbuild bundle → load in headless
Firefox → read results back, the same pattern as the existing
`verify:vectors:cross-client` harness).

| File size | Time    | Throughput | Envelope size | Envelope magic | OPFS used |
| --------- | ------- | ---------- | ------------- | -------------- | --------- |
| 32 MiB    | 3.80 s  | 8.4 MiB/s  | 33,554,910 B  | `OCE1`         | yes       |
| 256 MiB   | 35.31 s | 7.2 MiB/s  | 268,438,400 B | `OCE1`         | yes       |

Both sizes are at or above `STREAM_MIN_BYTES` (33,554,432 B = 32 MiB), so both
exercised the chunked path rather than the whole-file path.

Two things this establishes:

1. **The web path produces genuine ciphertext.** The returned envelope begins
   with the `OCE1` magic in both phases; the browser never receives or produces
   a plaintext envelope on this path.
2. **Throughput does not track file size.** An 8× increase in input size moves
   throughput from 8.4 to 7.2 MiB/s (−14%), not by 8×. This is the browser-side
   counterpart to the SDK result, where peak RSS stayed flat across a 4×
   size increase.

## Environment findings worth recording

- **OPFS was available** (`navigator.storage.getDirectory()` present) in this
  Firefox build, so the results above describe the **OPFS spool path**, which is
  the intended default. The buffered-Blob fallback was not exercised by this
  run and remains unmeasured; it is guarded by the documented
  `BUFFERED_MAX_BYTES` (1 GiB) ceiling that rejects with an explicit error.
- **`performance.memory` is unavailable in Firefox**, so browser-side heap
  could not be sampled and the benchmark reports `-1` for peak heap rather than
  a fabricated number. Memory for this path is therefore evidenced indirectly,
  by the flat throughput across an 8× size range, and by the code path itself
  (4 MiB slices, OPFS spool) — not by a browser memory measurement.

## Reproducing

```bash
# requires firefox + geckodriver on PATH
pnpm --filter @omnicloud/web bench:web-streaming
BENCH_SIZES=32,256 pnpm --filter @omnicloud/web bench:web-streaming   # explicit sizes
```

This is a recorded local evidence run, not a CI gate: the CI runner has no
browser or geckodriver, and the existing cross-client vector check has the same
constraint. The committed `packages/crypto` vector tests remain the automated
guard for the crypto itself.

## Not verified

- **Buffered-Blob fallback path** (browsers without OPFS) — not exercised; the
  1 GiB ceiling is code-enforced but untested at the boundary.
- **Browser memory ceiling** — not measurable here (no `performance.memory` in
  Firefox); would need a Chromium-based harness to measure directly.
- **Chromium** — the plan's original wording said "500 MB on Chromium". No
  Chromium or Playwright/Puppeteer is installed in this environment, so the
  measurement was made in Firefox instead. The result is honest about which
  browser it describes.
- **Safari/WebKit** — not tested.
