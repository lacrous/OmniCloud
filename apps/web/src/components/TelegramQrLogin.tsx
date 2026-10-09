import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, errorMessage } from "../api/client";
import type { QrPollResponse, QrStartResponse, QrToken } from "../api/client";

const POLL_INTERVAL_MS = 2_000;

interface TelegramQrLoginProps {
  onSignedIn: () => Promise<void> | void;
  onPasswordRequired: (flowId: string) => void;
}

/**
 * Shows a QR code for the Telegram app to approve. Polls until the phone
 * approves, then hands control back to the page to finish sign-in.
 */
export function TelegramQrLogin({ onSignedIn, onPasswordRequired }: TelegramQrLoginProps) {
  const [flow, setFlow] = useState<QrStartResponse | null>(null);
  const [token, setToken] = useState<QrToken | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const approvedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.auth
      .startQrLogin()
      .then((started) => {
        if (cancelled) return;
        setFlow(started);
        setToken(started.token);
      })
      .catch((startError: unknown) => {
        if (!cancelled) setError(errorMessage(startError, "Could not start Telegram sign-in"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (token === null) return;
    let cancelled = false;
    QRCode.toDataURL(token.url, { margin: 1, width: 240 })
      .then((dataUrl) => {
        if (!cancelled) setImage(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError("Could not draw the QR code. Use the phone form below.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (flow === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled || approvedRef.current) return;
      try {
        const result: QrPollResponse = await api.auth.pollQrLogin(flow.flowId);
        if (cancelled) return;
        if (result.status === "ok") {
          approvedRef.current = true;
          setFinishing(true);
          await onSignedIn();
          return;
        }
        if (result.status === "password_required") {
          onPasswordRequired(flow.flowId);
          return;
        }
        if (result.status === "expired") {
          setFlow(null);
          setToken(null);
          return;
        }
        setToken(result.token);
      } catch (pollError) {
        if (!cancelled) setError(errorMessage(pollError, "Telegram sign-in ended. Try again."));
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [flow, onSignedIn, onPasswordRequired]);

  const restart = () => {
    approvedRef.current = false;
    setError(null);
    setImage(null);
    setFlow(null);
    setToken(null);
    api.auth
      .startQrLogin()
      .then((started) => {
        setFlow(started);
        setToken(started.token);
      })
      .catch((startError: unknown) =>
        setError(errorMessage(startError, "Could not start Telegram sign-in")),
      );
  };

  return (
    <section aria-labelledby="qr-login-heading" className="grid gap-3">
      <div>
        <h2 id="qr-login-heading" className="text-base font-semibold">
          Connect with the Telegram app
        </h2>
        <p className="muted mt-1 text-sm">
          Open Telegram on your phone, go to Settings → Devices → Link Desktop Device, and scan this
          code.
        </p>
      </div>

      <div className="flex min-h-[248px] items-center justify-center rounded-lg border p-3">
        {finishing ? (
          <div role="status" className="flex items-center gap-2.5 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold-text" aria-hidden="true" />
            <span>Approved. Preparing your private storage...</span>
          </div>
        ) : image !== null ? (
          <img
            src={image}
            alt="Telegram login QR code"
            width={240}
            height={240}
            className="h-60 w-60"
          />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-gold-text" aria-label="Loading QR code" />
        )}
      </div>

      {error !== null ? (
        <div role="alert" className="notice notice-error">
          {error}{" "}
          <button type="button" className="font-semibold underline" onClick={restart}>
            Try again
          </button>
        </div>
      ) : null}

      {token !== null && !finishing ? (
        <p className="muted text-xs">The code refreshes automatically while you wait.</p>
      ) : null}
    </section>
  );
}
