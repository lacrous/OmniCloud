import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, Loader2 } from "lucide-react";
import { useState } from "react";
import type { SessionInfo } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { ME_QUERY_KEY } from "../lib/queries";

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
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <div className="card w-full max-w-md p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/50 bg-gold-soft">
          <Cloud className="h-6 w-6 text-gold" aria-hidden="true" />
        </span>
        <span className="eyebrow mt-5">Finish setup</span>
        <h1 className="mt-4 text-2xl font-bold tracking-[-0.02em]">
          Finish setting up your storage
        </h1>
        <p className="muted mt-2 text-sm leading-relaxed">
          OmniCloud stores your files in a private Telegram channel. Create it now to start
          uploading.
        </p>
        <button
          type="button"
          className="btn-gold mt-6 justify-center"
          disabled={ensureMutation.isPending}
          onClick={() => {
            setError(null);
            ensureMutation.mutate();
          }}
        >
          {ensureMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {ensureMutation.isPending
            ? "Creating your private storage channel…"
            : "Create private storage channel"}
        </button>
        {error !== null && !ensureMutation.isPending ? (
          <div role="alert" className="notice notice-error">
            {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}
