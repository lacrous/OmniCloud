import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { LOGGER_OPTIONS } from "../src/logging";

function captureLog(run: (log: ReturnType<typeof Fastify>["log"]) => void): string {
  let output = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      output += chunk.toString();
      cb();
    },
  });
  const app = Fastify({ logger: { ...LOGGER_OPTIONS("info"), stream } as never });
  run(app.log);
  return output;
}

describe("log redaction", () => {
  it("masks a Telegram session string logged as a field", () => {
    const out = captureLog((log) =>
      log.info({ session: { stringSession: "AQAAsecretsessionvalue" } }, "x"),
    );
    expect(out).not.toContain("AQAAsecretsessionvalue");
    expect(out).toContain("[Redacted]");
  });

  it("masks a password, a login code, and a token", () => {
    const out = captureLog((log) =>
      log.info({ password: "hunter2", code: "12345", token: "tok_abcdef" }, "auth"),
    );
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("12345");
    expect(out).not.toContain("tok_abcdef");
  });

  it("masks the request cookie header", () => {
    const out = captureLog((log) =>
      log.info({ req: { headers: { cookie: "omnicloud_session=supersecretcookie" } } }, "req"),
    );
    expect(out).not.toContain("supersecretcookie");
  });

  it("leaves ordinary operational fields readable", () => {
    const out = captureLog((log) =>
      log.info({ fileId: "file-1", durationMs: 42 }, "upload.completed"),
    );
    expect(out).toContain("file-1");
    expect(out).toContain("42");
    expect(out).toContain("upload.completed");
  });
});
