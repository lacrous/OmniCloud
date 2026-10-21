import { Copy, KeyRound, LifeBuoy, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import {
  createRecoveryBlob,
  generateRecoveryCode,
  openRecoveryBlob,
  parseRecoveryCode,
} from "@omnicloud/crypto";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { base64ToBytes, bytesToBase64 } from "../lib/bytes";
import {
  ENCRYPT_UPLOADS_KEY,
  clear as clearKey,
  generate as generateKey,
  isEncryptUploadsPref,
  toHex,
  unlockFromHex,
  useCryptoSession,
} from "../lib/crypto-session";
import type { EncryptUploadsPref } from "../lib/crypto-session";
import { useToast } from "./Toasts";

/**
 * "Encryption (experimental)" settings block: generate / unlock / clear the
 * in-memory URK and opt in to encrypting new uploads. Rendered on the
 * settings (API tokens) page.
 */
export function EncryptionSettings() {
  const toast = useToast();
  const urk = useCryptoSession();
  const active = urk !== null;

  const [generatedHex, setGeneratedHex] = useState<string | null>(null);
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [encryptUploads, setEncryptUploads] = useLocalStorage<EncryptUploadsPref>(
    ENCRYPT_UPLOADS_KEY,
    "off",
    isEncryptUploadsPref,
  );

  const handleGenerate = () => {
    setGeneratedHex(toHex(generateKey()));
    setUnlockValue("");
    setUnlockError(null);
  };

  const handleUnlock = (event: FormEvent) => {
    event.preventDefault();
    try {
      unlockFromHex(unlockValue);
    } catch (error) {
      setUnlockError(errorMessage(error, "Invalid key"));
      return;
    }
    setUnlockError(null);
    setUnlockValue("");
    setGeneratedHex(null);
    toast.success("Encryption key unlocked for this tab");
  };

  const handleClear = () => {
    clearKey();
    setGeneratedHex(null);
    setUnlockValue("");
    setUnlockError(null);
    toast.success("Encryption key cleared from this tab");
  };

  const copyGenerated = async () => {
    if (generatedHex === null) return;
    try {
      await navigator.clipboard.writeText(generatedHex);
      toast.success("Key copied");
    } catch {
      toast.error("Could not copy. Select the key and copy it manually.");
    }
  };

  // ── Recovery record: server stores only ciphertext the code can open ─────
  const [recoveryConfigured, setRecoveryConfigured] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [restoreValue, setRestoreValue] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.recovery
      .get()
      .then((result) => {
        if (!cancelled) setRecoveryConfigured(result.recoveryBlob !== null);
      })
      .catch(() => {
        // Signed out or unreachable: keep the conservative default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerateRecovery = async () => {
    if (urk === null || recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      const { code, bytes } = generateRecoveryCode();
      const blob = bytesToBase64(createRecoveryBlob(urk, bytes));
      await api.recovery.set(blob);
      setRecoveryCode(code);
      setRecoveryConfigured(true);
      toast.success("Recovery record saved to your account");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the recovery record"));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyRecoveryCode = async () => {
    if (recoveryCode === null) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      toast.success("Recovery code copied");
    } catch {
      toast.error("Could not copy. Select the code and copy it manually.");
    }
  };

  const handleRestore = async (event: FormEvent) => {
    event.preventDefault();
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      const codeBytes = parseRecoveryCode(restoreValue);
      const result = await api.recovery.get();
      if (result.recoveryBlob === null) {
        setRestoreError("No recovery record exists for this account.");
        return;
      }
      const urkBytes = openRecoveryBlob(base64ToBytes(result.recoveryBlob), codeBytes);
      unlockFromHex(toHex(urkBytes));
      setRestoreValue("");
      setRestoreError(null);
      toast.success("Encryption key restored from the recovery code");
    } catch (error) {
      setRestoreError(errorMessage(error, "Could not restore the key"));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleRemoveRecovery = async () => {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      await api.recovery.remove();
      setRecoveryConfigured(false);
      setRecoveryCode(null);
      toast.success("Recovery record removed");
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove the recovery record"));
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <section className="card space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold">Encryption (experimental)</h2>
        <p className="muted mt-1 text-[13px]">
          Client-side end-to-end encryption for file contents. Experimental and not yet
          independently audited — filenames are still sent to the server for listing.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[13px]">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-ok" : "bg-line-strong"}`}
          aria-hidden="true"
        />
        <span className="font-medium">{active ? "Key active" : "Not active"}</span>
        <span className="muted">· held in memory for this tab only, never stored</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-gold" onClick={handleGenerate}>
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Generate key
        </button>
        <button type="button" className="btn-ghost" onClick={handleClear} disabled={!active}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear key
        </button>
      </div>

      {generatedHex !== null ? (
        <div className="space-y-2 rounded-xl border border-gold/50 bg-gold-soft p-4">
          <p className="text-[13px] font-semibold text-gold-text">
            Save this key now — it is shown only once
          </p>
          <p className="muted text-[12.5px]">
            Copy it somewhere safe and offline. It cannot be recovered: without it, files encrypted
            with it can never be opened again, and it is not saved on this device.
          </p>
          <code className="block rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12.5px] break-all select-all">
            {generatedHex}
          </code>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={copyGenerated}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Copy
            </button>
            <button type="button" className="btn-ghost" onClick={() => setGeneratedHex(null)}>
              I have saved it
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleUnlock} className="space-y-2">
        <label className="block text-[13px] font-medium" htmlFor="encryption-unlock-key">
          Unlock by pasting a key
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="encryption-unlock-key"
            type="text"
            value={unlockValue}
            onChange={(event) => {
              setUnlockValue(event.target.value);
              if (unlockError !== null) setUnlockError(null);
            }}
            placeholder="64 hexadecimal characters"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-bg-soft px-3 py-2 font-mono text-[13px] outline-none focus:border-gold"
          />
          <button
            type="submit"
            className="btn-secondary"
            disabled={unlockValue.trim().length === 0}
          >
            Unlock
          </button>
        </div>
        {unlockError !== null ? (
          <p role="alert" className="text-[12.5px] text-bad">
            {unlockError}
          </p>
        ) : null}
      </form>

      <div className="border-t border-line pt-4">
        <label
          className={`flex items-start gap-3 ${active ? "cursor-pointer" : "cursor-not-allowed"}`}
        >
          <input
            type="checkbox"
            checked={encryptUploads === "on"}
            disabled={!active}
            onChange={(event) => setEncryptUploads(event.target.checked ? "on" : "off")}
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
          />
          <span>
            <span className="block text-[13px] font-medium">Encrypt new uploads</span>
            <span className="muted block text-[12.5px]">
              {active
                ? "New uploads and new versions are encrypted in this browser before they are sent."
                : "No key active — generate or unlock a key first. Uploads stay plaintext until then."}
            </span>
          </span>
        </label>
      </div>

      <div className="border-t border-line pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-gold-text" aria-hidden="true" />
          <h3 className="text-[13px] font-semibold">Recovery code</h3>
          {recoveryConfigured ? (
            <span className="rounded-full border border-line bg-bg-soft px-2 py-0.5 text-[11px] muted">
              saved on account
            </span>
          ) : null}
        </div>
        <p className="muted text-[12.5px] leading-5">
          A recovery code is a second, offline way back to your encryption key. Your account stores
          only ciphertext that the code can open — the code itself never leaves this device. Lose
          both the key and the code, and encrypted files are unrecoverable.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleGenerateRecovery}
            disabled={!active || recoveryBusy}
          >
            {recoveryBusy && recoveryCode === null ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            )}
            {recoveryConfigured ? "Regenerate recovery code" : "Generate recovery code"}
          </button>
          {recoveryConfigured ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={handleRemoveRecovery}
              disabled={recoveryBusy}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove record
            </button>
          ) : null}
        </div>
        {!active ? (
          <p className="muted text-[12px]">
            Generate or unlock a key first — the code wraps the active key.
          </p>
        ) : null}

        {recoveryCode !== null ? (
          <div className="space-y-2 rounded-xl border border-gold/50 bg-gold-soft p-4">
            <p className="text-[13px] font-semibold text-gold-text">
              Save this recovery code now — it is shown only once
            </p>
            <p className="muted text-[12.5px]">
              Store it offline, separate from your key. Anyone with this code and your account can
              restore your encryption key.
            </p>
            <code className="block rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12.5px] break-all select-all">
              {recoveryCode}
            </code>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={copyRecoveryCode}>
                <Copy className="h-4 w-4" aria-hidden="true" /> Copy
              </button>
              <button type="button" className="btn-ghost" onClick={() => setRecoveryCode(null)}>
                I have saved it
              </button>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleRestore} className="space-y-2">
          <label className="block text-[13px] font-medium" htmlFor="recovery-restore-code">
            Restore key from a recovery code
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="recovery-restore-code"
              type="text"
              value={restoreValue}
              onChange={(event) => {
                setRestoreValue(event.target.value);
                if (restoreError !== null) setRestoreError(null);
              }}
              placeholder="xxxx-xxxx-… (64 hex characters)"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 rounded-lg border border-line-strong bg-bg-soft px-3 py-2 font-mono text-[13px] outline-none focus:border-gold"
            />
            <button
              type="submit"
              className="btn-secondary"
              disabled={restoreValue.trim().length === 0 || recoveryBusy}
            >
              Restore
            </button>
          </div>
          {restoreError !== null ? (
            <p role="alert" className="text-[12.5px] text-bad">
              {restoreError}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
