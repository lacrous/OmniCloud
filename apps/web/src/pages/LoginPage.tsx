import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { ThemeToggle } from "../components/ThemeToggle";
import { useMe } from "../hooks/useMe";
import { ME_QUERY_KEY } from "../lib/queries";

type Step = "phone" | "code" | "password";

const CODE_PATTERN = /^\d{3,10}$/;

const GOLD_LINK = "font-semibold text-gold-text transition-colors hover:underline";

export default function LoginPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const finishSignIn = useCallback(async (): Promise<void> => {
    try {
      const session = await api.auth.me();
      queryClient.setQueryData(ME_QUERY_KEY, session);
      navigate("/", { replace: true });
    } catch {
      setError("Signed in, but loading your drive failed. Please reload the page.");
    } finally {
      setFinishing(false);
    }
  }, [queryClient, navigate]);

  const startMutation = useMutation({
    mutationFn: () => api.auth.startLogin(phone.trim()),
    onSuccess: () => {
      setError(null);
      setStep("code");
    },
    onError: (mutationError) =>
      setError(errorMessage(mutationError, "Could not send the login code")),
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.auth.verifyCode(phone.trim(), code.trim()),
    onSuccess: async (result) => {
      if (result.status === "password_required") {
        setError(null);
        setStep("password");
        return;
      }
      await finishSignIn();
    },
    onError: (mutationError) =>
      setError(errorMessage(mutationError, "The login code was rejected")),
    onSettled: () => setFinishing(false),
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.auth.verifyPassword(phone.trim(), password),
    onSuccess: async () => {
      await finishSignIn();
    },
    onError: (mutationError) => setError(errorMessage(mutationError, "The password was rejected")),
    onSettled: () => setFinishing(false),
  });

  if (me.data !== undefined && me.data.user !== null) {
    return <Navigate to="/" replace />;
  }

  const busy =
    startMutation.isPending || verifyMutation.isPending || passwordMutation.isPending || finishing;
  const preparing = verifyMutation.isPending || passwordMutation.isPending || finishing;

  const submitPhone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || phone.trim() === "") return;
    setError(null);
    startMutation.mutate();
  };

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!CODE_PATTERN.test(code.trim())) {
      setError("Please enter the numeric code Telegram sent you");
      return;
    }
    setError(null);
    setFinishing(true);
    verifyMutation.mutate();
  };

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || password === "") return;
    setError(null);
    setFinishing(true);
    passwordMutation.mutate();
  };

  const backToPhone = () => {
    setStep("phone");
    setCode("");
    setError(null);
  };

  const errorText =
    error !== null ? (
      <div role="alert" className="notice notice-error">
        {error}
      </div>
    ) : null;

  const preparingText = preparing ? (
    <div role="status" className="notice flex items-center gap-2.5">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold-text" aria-hidden="true" />
      <span>Preparing your private storage…</span>
    </div>
  ) : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <a href="#main" className="skip-link btn-gold">
        Skip to content
      </a>

      {/* ------------------------------ brand panel ------------------------------ */}
      <aside
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-10"
        style={{ background: "linear-gradient(160deg, #c9a227 0%, #a8801a 55%, #8a6712 100%)" }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255, 255, 255, 0.35), transparent 65%)",
          }}
        />
        <a
          href="/"
          className="relative flex items-center gap-2.5 text-[15px] font-semibold text-white"
        >
          <span className="text-lg leading-none">◈</span> Omni
          <span className="font-normal text-white/80">Cloud</span>
        </a>

        <div className="relative">
          <p className="text-[clamp(34px,3.4vw,48px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">
            Your drive.
            <br />
            Powered by Telegram.
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/85">
            Every file lands in a private Telegram channel that is created for your account on first
            sign-in — storage you already own, with no extra servers in the way.
          </p>
        </div>

        <p className="relative text-xs text-white/70">
          © 2026 OmniCloud · self-hosted storage on your Telegram.
        </p>
      </aside>

      {/* -------------------------------- form side ------------------------------- */}
      <main id="main" className="flex min-h-dvh flex-col px-5 py-7">
        <div className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 text-[15px] font-semibold lg:invisible">
            <span className="text-lg leading-none text-gold">◈</span> Omni
            <span className="muted font-normal">Cloud</span>
          </a>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            {step === "phone" ? (
              <>
                <form onSubmit={submitPhone} noValidate className="grid gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-[-0.02em]">Sign in with Telegram</h1>
                    <p className="muted mt-1.5 text-sm">
                      Enter your phone number to receive a login code.
                    </p>
                  </div>
                  <label htmlFor="login-phone" className="grid gap-1.5">
                    <span className="text-[13px] font-medium">Phone number</span>
                    <input
                      id="login-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+15551234567"
                      value={phone}
                      disabled={busy}
                      onChange={(event) => setPhone(event.target.value)}
                      className="input"
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-gold mt-1 justify-center"
                    disabled={busy || phone.trim() === ""}
                  >
                    {startMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {startMutation.isPending ? "Sending code…" : "Continue"}
                  </button>
                </form>
                {errorText}
              </>
            ) : step === "code" ? (
              <>
                <form onSubmit={submitCode} noValidate className="grid gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-[-0.02em]">Enter the code</h1>
                    <p className="muted mt-1.5 text-sm">
                      Enter the code Telegram sent to <span className="font-medium">{phone}</span>.
                    </p>
                  </div>
                  <label htmlFor="login-code" className="grid gap-1.5">
                    <span className="text-[13px] font-medium">Login code</span>
                    <input
                      id="login-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      value={code}
                      disabled={busy}
                      onChange={(event) => setCode(event.target.value)}
                      className="input tracking-[0.3em]"
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-gold mt-1 justify-center"
                    disabled={busy || code.trim() === ""}
                  >
                    {verifyMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {verifyMutation.isPending ? "Verifying…" : "Verify"}
                  </button>
                </form>
                {preparingText}
                {errorText}
                <button
                  type="button"
                  onClick={backToPhone}
                  disabled={busy}
                  className={`mt-4 w-full text-center text-sm disabled:opacity-60 ${GOLD_LINK}`}
                >
                  Use a different number →
                </button>
              </>
            ) : (
              <>
                <form onSubmit={submitPassword} noValidate className="grid gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-[-0.02em]">Two-factor password</h1>
                    <p className="muted mt-1.5 text-sm">
                      Your Telegram account is protected with a cloud password.
                    </p>
                  </div>
                  <label htmlFor="login-password" className="grid gap-1.5">
                    <span className="text-[13px] font-medium">Password</span>
                    <input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      value={password}
                      disabled={busy}
                      onChange={(event) => setPassword(event.target.value)}
                      className="input"
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-gold mt-1 justify-center"
                    disabled={busy || password === ""}
                  >
                    {(passwordMutation.isPending || finishing) && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {passwordMutation.isPending || finishing ? "Signing in…" : "Sign in"}
                  </button>
                </form>
                {preparingText}
                {errorText}
                <button
                  type="button"
                  onClick={() => {
                    setStep("code");
                    setPassword("");
                    setError(null);
                  }}
                  disabled={busy}
                  className={`mt-4 w-full text-center text-sm disabled:opacity-60 ${GOLD_LINK}`}
                >
                  Back to the code →
                </button>
              </>
            )}

            <p className="notice mt-6">
              OmniCloud uses your Telegram account as its storage backend. Files are stored in a
              private Telegram channel that is created automatically.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
