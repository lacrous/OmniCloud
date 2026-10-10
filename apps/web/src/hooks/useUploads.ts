import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { errorMessage } from "../api/client";
import { replaceFile, uploadFile } from "../api/upload";
import { invalidateDriveQueries, invalidateVersionQueries } from "../lib/queries";
import { useToast } from "../components/Toasts";

export type UploadStatus = "uploading" | "done" | "error" | "cancelled";

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  loaded: number;
  percent: number;
  status: UploadStatus;
  message?: string;
}

interface UploadJob {
  id: number;
  file: File;
  /** null = new file in a folder; a string = new version of that file id. */
  replaceId: string | null;
  folderId: string | null;
  /** Stable for the job's life, so a retry is recognised by the server as the same upload. */
  operationId: string;
}

let uploadIdCounter = 0;

/** A unique key per upload job. Falls back where randomUUID is unavailable (insecure origins). */
function newOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface UploadsController {
  uploads: UploadItem[];
  enqueue: (files: File[], folderId: string | null) => void;
  replace: (file: File, fileId: string) => void;
  cancel: (id: number) => void;
  retry: (id: number) => void;
  dismiss: (id: number) => void;
  clearFinished: () => void;
  /** Opens the native file picker; files go into the given folder. */
  openPicker: (folderId: string | null) => void;
  /** Hidden input backing `openPicker` — render it once in the layout. */
  pickerInputRef: RefObject<HTMLInputElement>;
  /** Wire to the hidden input's onChange. */
  onPickerChange: () => void;
}

/**
 * Owns the upload queue: sequential processing, per-item progress, cancel via
 * AbortController/XHR.abort, and retry of failed or cancelled uploads.
 */
export function useUploads(): UploadsController {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const jobs = useRef(new Map<number, UploadJob>());
  const controllers = useRef(new Map<number, AbortController>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timers = useRef(new Set<number>());
  const mounted = useRef(true);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const pickerFolder = useRef<string | null>(null);

  useEffect(() => {
    const registeredTimers = timers.current;
    // Snapshot the Map instance: the ref itself may be reassigned, but the
    // live controllers are the ones created during this mount.
    const registeredControllers = controllers.current;
    return () => {
      mounted.current = false;
      for (const timer of registeredTimers) window.clearTimeout(timer);
      for (const controller of registeredControllers.values()) controller.abort();
    };
  }, []);

  const scheduleDismiss = useCallback((id: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setUploads((prev) => prev.filter((entry) => entry.id !== id));
      jobs.current.delete(id);
    }, 5000);
    timers.current.add(timer);
  }, []);

  const run = useCallback(
    async (job: UploadJob): Promise<void> => {
      const controller = new AbortController();
      controllers.current.set(job.id, controller);
      try {
        const options = {
          signal: controller.signal,
          onProgress: ({
            loaded,
            total,
            percent,
          }: {
            loaded: number;
            total: number;
            percent: number;
          }) => {
            setUploads((prev) =>
              prev.map((entry) =>
                entry.id === job.id
                  ? { ...entry, loaded, size: total || entry.size, percent }
                  : entry,
              ),
            );
          },
        };
        const result =
          job.replaceId === null
            ? await uploadFile(job.file, job.folderId, { ...options, operationId: job.operationId })
            : await replaceFile(job.file, job.replaceId, {
                ...options,
                operationId: job.operationId,
              });
        if (!mounted.current) return;
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === job.id ? { ...entry, status: "done", percent: 100 } : entry,
          ),
        );
        invalidateDriveQueries(queryClient);
        if (job.replaceId !== null) invalidateVersionQueries(queryClient, job.replaceId);
        toast.success(
          job.replaceId === null ? `Uploaded "${result.name}"` : `Replaced "${result.name}"`,
        );
        scheduleDismiss(job.id);
      } catch (error) {
        if (!mounted.current) return;
        const message = errorMessage(error, "Upload failed");
        const cancelled = message === "Upload cancelled";
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === job.id
              ? { ...entry, status: cancelled ? "cancelled" : "error", message }
              : entry,
          ),
        );
        if (!cancelled) toast.error(`Could not upload "${job.file.name}": ${message}`);
      } finally {
        controllers.current.delete(job.id);
      }
    },
    [queryClient, scheduleDismiss, toast],
  );

  const enqueueJob = useCallback(
    (job: UploadJob) => {
      jobs.current.set(job.id, job);
      setUploads((prev) => [
        ...prev,
        {
          id: job.id,
          name: job.file.name,
          size: job.file.size,
          loaded: 0,
          percent: 0,
          status: "uploading",
        },
      ]);
      queue.current = queue.current.then(() => run(job));
    },
    [run],
  );

  const enqueue = useCallback(
    (files: File[], folderId: string | null) => {
      for (const file of files) {
        uploadIdCounter += 1;
        enqueueJob({
          id: uploadIdCounter,
          file,
          replaceId: null,
          folderId,
          operationId: newOperationId(),
        });
      }
    },
    [enqueueJob],
  );

  const replace = useCallback(
    (file: File, fileId: string) => {
      uploadIdCounter += 1;
      enqueueJob({
        id: uploadIdCounter,
        file,
        replaceId: fileId,
        folderId: null,
        operationId: newOperationId(),
      });
    },
    [enqueueJob],
  );

  const cancel = useCallback((id: number) => {
    controllers.current.get(id)?.abort();
  }, []);

  const retry = useCallback(
    (id: number) => {
      const job = jobs.current.get(id);
      if (job === undefined) return;
      setUploads((prev) =>
        prev.map((entry) =>
          entry.id === id
            ? { ...entry, status: "uploading", percent: 0, loaded: 0, message: undefined }
            : entry,
        ),
      );
      queue.current = queue.current.then(() => run(job));
    },
    [run],
  );

  const dismiss = useCallback((id: number) => {
    controllers.current.get(id)?.abort();
    jobs.current.delete(id);
    setUploads((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setUploads((prev) => {
      for (const entry of prev) if (entry.status !== "uploading") jobs.current.delete(entry.id);
      return prev.filter((entry) => entry.status === "uploading");
    });
  }, []);

  const openPicker = useCallback((folderId: string | null) => {
    pickerFolder.current = folderId;
    pickerInputRef.current?.click();
  }, []);

  const onPickerChange = useCallback(() => {
    const input = pickerInputRef.current;
    if (input === null) return;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) enqueue(files, pickerFolder.current);
  }, [enqueue]);

  return {
    uploads,
    enqueue,
    replace,
    cancel,
    retry,
    dismiss,
    clearFinished,
    openPicker,
    pickerInputRef,
    onPickerChange,
  };
}
