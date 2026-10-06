import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SessionInfo } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { ME_QUERY_KEY } from "../lib/queries";
import { CloudIcon, Spinner } from "../components/icons";

/** Fallback screen shown when the signed-in user has no storage channel yet. */
export default function StorageInit() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const ensureMutation = useMutation({
    mutationFn: api.storage.ensure,
    onSuccess: (result) => {
      queryClient.setQueryData<SessionInfo>(ME_QUERY_KEY, (current) =>
        current === undefined ? current : { ...current, storage: result.storage },
      );
    },
    onError: (mutationError) =>
      setError(errorMessage(mutationError, "Could not create your storage channel")),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
      <div className="oc-card w-full max-w-md p-8 text-center shadow-sm">
        <CloudIcon className="mx-auto h-10 w-10 text-indigo-600" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900">Finish setting up your storage</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          OmniCloud stores your files in a private Telegram channel. Create it now to start
          uploading.
        </p>
        {ensureMutation.isPending ? (
          <p
            role="status"
            className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500"
          >
            <Spinner className="h-4 w-4 text-indigo-600" />
            Creating your private storage channel…
          </p>
        ) : (
          <button
            type="button"
            className="oc-btn-primary mt-6"
            onClick={() => {
              setError(null);
              ensureMutation.mutate();
            }}
          >
            Create private storage channel
          </button>
        )}
        {error !== null && !ensureMutation.isPending ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
