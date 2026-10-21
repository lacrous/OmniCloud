import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../api/client";
import type { ApiTokenCreatedDTO } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EncryptionSettings } from "../components/EncryptionSettings";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { NameDialog } from "../components/NameDialog";
import { PageHeader, PageTitle } from "../components/PageHeader";
import { useToast } from "../components/Toasts";
import { formatDateTime, formatRelative } from "../lib/format";

const TOKENS_QUERY_KEY = ["tokens"] as const;

export function TokensPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiTokenCreatedDTO | null>(null);

  const tokens = useQuery({
    queryKey: TOKENS_QUERY_KEY,
    queryFn: () => api.tokens.list(),
  });

  const create = useMutation({
    mutationFn: (name: string) => api.tokens.create(name),
    onSuccess: (token) => {
      setCreating(false);
      setCreated(token);
      void queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not create the token")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => {
      setRevokeId(null);
      toast.success("Token revoked");
      void queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not revoke the token")),
  });

  const list = tokens.data?.tokens ?? [];
  const active = list.filter((t) => t.revokedAt === null);
  const revoking = list.find((t) => t.id === revokeId);

  const copySecret = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      toast.success("Token copied");
    } catch {
      toast.error("Could not copy. Select the token and copy it manually.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <PageHeader
        title={<PageTitle>API tokens</PageTitle>}
        actions={
          <button type="button" className="btn-gold" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New token
          </button>
        }
      >
        <p className="muted text-sm">
          Tokens let scripts and the SDK use your account. Each token has full access, the same as
          your signed-in browser, so revoke any token you no longer use.
        </p>
      </PageHeader>

      {created && (
        <div className="card space-y-3 p-5">
          <p className="text-sm font-semibold">Copy your new token now</p>
          <p className="muted text-sm">
            This is the only time the token is shown. Store it somewhere safe.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg-soft px-3 py-2 font-mono text-sm">
              {created.token}
            </code>
            <button type="button" className="btn-ghost" onClick={copySecret}>
              <Copy className="h-4 w-4" /> Copy
            </button>
          </div>
          <button
            type="button"
            className="muted text-sm underline"
            onClick={() => setCreated(null)}
          >
            I have copied it
          </button>
        </div>
      )}

      <section className="card divide-y divide-line">
        {tokens.isPending && (
          <div className="flex justify-center p-8">
            <LoadingSpinner />
          </div>
        )}
        {tokens.isError && (
          <p className="p-5 text-sm text-bad">
            {errorMessage(tokens.error, "Could not load tokens")}
          </p>
        )}
        {tokens.isSuccess && active.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <KeyRound className="h-6 w-6 text-gold-text" aria-hidden />
            <p className="text-sm font-semibold">No active tokens</p>
            <p className="muted text-sm">Create one to use the SDK or a script.</p>
          </div>
        )}
        {active.map((t) => (
          <div key={t.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.name}</p>
              <p className="muted text-xs">
                Created {formatDateTime(t.createdAt)}
                {t.lastUsedAt ? ` · last used ${formatRelative(t.lastUsedAt)}` : " · not used yet"}
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost"
              aria-label={`Revoke ${t.name}`}
              onClick={() => setRevokeId(t.id)}
            >
              <Trash2 className="h-4 w-4" /> Revoke
            </button>
          </div>
        ))}
      </section>

      {creating && (
        <NameDialog
          title="New API token"
          label="Token name"
          confirmLabel="Create token"
          initialValue=""
          pending={create.isPending}
          onSubmit={(name) => create.mutate(name)}
          onClose={() => setCreating(false)}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title="Revoke this token?"
          message={`"${revoking.name}" will stop working immediately. Any script using it will fail.`}
          confirmLabel="Revoke"
          destructive
          busy={revoke.isPending}
          onConfirm={() => revoke.mutate(revoking.id)}
          onClose={() => setRevokeId(null)}
        />
      )}

      <EncryptionSettings />
    </div>
  );
}
