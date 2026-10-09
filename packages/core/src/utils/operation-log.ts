/**
 * One structured record per storage operation: what happened, how long it took,
 * and whether it worked. Fields are operational only. The operation never
 * receives file contents, names of secrets, or session material, so none can
 * be logged from here.
 */
export interface OperationRecord {
  operation: "upload" | "download" | "delete" | "replace";
  userId: string;
  resourceId: string | null;
  sizeBytes: number | null;
  durationMs: number;
  status: "ok" | "error";
  errorCode: string | null;
}

export interface OperationSink {
  info(record: Record<string, unknown>, message: string): void;
  warn(record: Record<string, unknown>, message: string): void;
}

/**
 * Times an operation and emits one record for it. The original error is always
 * rethrown unchanged, and a failure to write the log never fails the operation.
 */
export async function timedOperation<T>(
  sink: OperationSink | null,
  base: {
    operation: OperationRecord["operation"];
    userId: string;
    resourceId?: string | null;
    sizeBytes?: number | null;
  },
  run: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const started = now();
  const emit = (status: "ok" | "error", errorCode: string | null) => {
    if (!sink) return;
    const record: OperationRecord = {
      operation: base.operation,
      userId: base.userId,
      resourceId: base.resourceId ?? null,
      sizeBytes: base.sizeBytes ?? null,
      durationMs: now() - started,
      status,
      errorCode,
    };
    try {
      if (status === "ok") sink.info({ ...record }, `${base.operation}.completed`);
      else sink.warn({ ...record }, `${base.operation}.failed`);
    } catch {
      // Logging must never change the outcome of the operation.
    }
  };
  try {
    const result = await run();
    emit("ok", null);
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "INTERNAL_ERROR";
    emit("error", code);
    throw error;
  }
}
