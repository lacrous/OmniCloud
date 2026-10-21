import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api/client";
const TelegramQrLogin = lazy(() =>
  import("../components/TelegramQrLogin").then((module) => ({ default: module.TelegramQrLogin })),
);
import { ThemeToggle } from "../components/ThemeToggle";
import { useMe } from "../hooks/useMe";
import { ME_QUERY_KEY } from "../lib/queries";
import { usePageMeta } from "../lib/seo";

type Step = "phone" | "code" | "password";
type SignInMode = "qr" | "phone";

const CODE_PATTERN = /^\d{3,10}$/;

const GOLD_LINK = "font-semibold text-gold-text  hover:underline";

export default function LoginPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  usePageMeta({
    title: "Sign in — OmniCloud",
    description: "Sign in to OmniCloud with Telegram and open your private drive.",
    noindex: true,
    path: "/login",
  });

  const [step, setStep] = useState<Step>("phone");
  const [signInMode, setSignInMode] = useState<SignInMode>("qr");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [qrFlowId, setQrFlowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const finishSignIn = useCallback(async (): Promise<void> => {
    try {
      const session = await api.auth.me();
      queryClient.setQueryData(ME_QUERY_KEY, session);
      navigate("/drive", { replace: true });
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
    mutationFn: () =>
      qrFlowId !== null
        ? api.auth.submitQrPassword(qrFlowId, password)
        : api.auth.verifyPassword(phone.trim(), password),
    onSuccess: async () => {
      await finishSignIn();
    },
    onError: (mutationError) => setError(errorMessage(mutationError, "The password was rejected")),
    onSettled: () => setFinishing(false),
  });

  if (me.data !== undefined && me.data.user !== null) {
    return <Navigate to="/drive" replace />;
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
    <div className="relative min-h-dvh overflow-hidden bg-bg">
      <a href="#main" className="skip-link btn-gold">
        Skip to content
      </a>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 left-[45%] h-[34rem] w-[34rem] rounded-full bg-gold/10 blur-3xl" />
        <div className="absolute -bottom-48 -left-48 h-[30rem] w-[30rem] rounded-full bg-gold/5 blur-3xl" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
        <a href="/" className="flex items-center gap-3" aria-label="OmniCloud home">
          <span className="relative h-10 w-10 shrink-0">
            <img
              src="/brand/logo-mark.svg"
              alt=""
              className="brand-mark-dark absolute inset-0 h-10 w-10"
            />
            <img
              src="/brand/logo-mark-light.svg"
              alt=""
              className="brand-mark-light absolute inset-0 h-10 w-10"
            />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Omni<span className="muted font-normal">Cloud</span>
          </span>
        </a>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-2 text-xs muted sm:flex">
            <LockKeyhole className="h-3.5 w-3.5 text-gold-text" aria-hidden="true" />
            Private by design
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto grid min-h-[calc(100dvh-76px)] w-full max-w-7xl items-center gap-6 px-5 py-3 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10 lg:px-12 lg:py-4"
      >
        <section className="hidden max-w-xl lg:block" aria-labelledby="welcome-heading">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/10 px-3.5 py-2 text-xs font-semibold tracking-wide text-gold-text">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            YOUR FILES. YOUR TELEGRAM.
          </div>
          <h1
            id="welcome-heading"
            className="text-5xl font-semibold leading-[1.08] tracking-[-0.055em] xl:text-6xl"
          >
            A calmer home
            <br />
            for your <span className="text-gold-text">files.</span>
          </h1>
          <p className="muted mt-4 max-w-lg text-base leading-7">
            Your personal cloud drive, backed by a private Telegram channel you control. Organize,
            search, and reach your files from one beautifully simple place.
          </p>

          <div className="mt-6 grid max-w-lg gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface/75 p-4 shadow-sm backdrop-blur">
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-gold/10 text-gold-text">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold">Your account, your storage</p>
              <p className="muted mt-1 text-xs leading-5">
                Files stay in your private Telegram channel.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-surface/75 p-4 shadow-sm backdrop-blur">
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-gold/10 text-gold-text">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold">A private connection</p>
              <p className="muted mt-1 text-xs leading-5">
                Sign in securely with Telegram’s official flow.
              </p>
            </div>
          </div>
          <p className="muted mt-6 text-xs">Self-hosted storage · no third-party cloud account</p>
        </section>

        <section
          className="mx-auto w-full max-w-[34rem] rounded-[1.75rem] border border-line bg-surface/90 p-4 shadow-[var(--shadow)] backdrop-blur-xl sm:p-6 lg:p-7"
          aria-label="Sign in to OmniCloud"
        >
          <div className="mb-4 lg:hidden">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-gold-text">
              YOUR FILES. YOUR TELEGRAM.
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
              Welcome to your drive.
            </h1>
          </div>
          {step === "phone" ? (
            <>
              <div
                className="mb-4 grid grid-cols-2 rounded-xl border border-line bg-bg-soft/70 p-1"
                role="tablist"
                aria-label="Choose a sign-in method"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={signInMode === "qr"}
                  onClick={() => setSignInMode("qr")}
                  className={`rounded-lg px-3 py-2 text-sm font-medium  ${signInMode === "qr" ? "bg-surface text-text shadow-sm" : "muted hover:text-text"}`}
                >
                  Scan QR code
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={signInMode === "phone"}
                  onClick={() => setSignInMode("phone")}
                  className={`rounded-lg px-3 py-2 text-sm font-medium  ${signInMode === "phone" ? "bg-surface text-text shadow-sm" : "muted hover:text-text"}`}
                >
                  Use phone number
                </button>
              </div>
              {signInMode === "qr" ? (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="min-h-[196px] animate-pulse rounded-xl border border-line bg-bg-soft/45"
                    />
                  }
                >
                  <TelegramQrLogin
                    onSignedIn={finishSignIn}
                    onPasswordRequired={(flowId) => {
                      setQrFlowId(flowId);
                      setStep("password");
                    }}
                  />
                </Suspense>
              ) : (
                <form onSubmit={submitPhone} noValidate className="grid gap-4 py-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.025em]">
                      Sign in with Telegram
                    </h2>
                    <p className="muted mt-1.5 text-sm">
                      We’ll send a one-time login code to your number.
                    </p>
                  </div>
                  <label htmlFor="login-phone" className="grid gap-1.5">
                    <span className="text-[13px] font-medium">Phone number</span>
                    <input
                      id="login-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+1 555 123 4567"
                      value={phone}
                      disabled={busy}
                      onChange={(event) => setPhone(event.target.value)}
                      className="input"
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-gold mt-1 w-full justify-center"
                    disabled={busy || phone.trim() === ""}
                  >
                    {startMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    )}
                    {startMutation.isPending ? "Sending code…" : "Continue with phone"}
                  </button>
                </form>
              )}
              {errorText}
            </>
          ) : step === "code" ? (
            <>
              <form onSubmit={submitCode} noValidate className="grid gap-4">
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-gold-text">
                    PHONE VERIFICATION
                  </p>
                  <h2 className="text-2xl font-semibold tracking-[-0.035em]">
                    Check your Telegram
                  </h2>
                  <p className="muted mt-2 text-sm leading-6">
                    Enter the code sent to <span className="font-medium text-text">{phone}</span>.
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
                  className="btn-gold mt-1 w-full justify-center"
                  disabled={busy || code.trim() === ""}
                >
                  {verifyMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {verifyMutation.isPending ? "Verifying…" : "Verify and continue"}
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
                  <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-gold-text">
                    ACCOUNT SECURITY
                  </p>
                  <h2 className="text-2xl font-semibold tracking-[-0.035em]">
                    Two-factor password
                  </h2>
                  <p className="muted mt-2 text-sm leading-6">
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
                  className="btn-gold mt-1 w-full justify-center"
                  disabled={busy || password === ""}
                >
                  {(passwordMutation.isPending || finishing) && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {passwordMutation.isPending || finishing ? "Signing in…" : "Sign in securely"}
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
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-bg-soft/70 p-3">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
            <p className="text-[11px] leading-4 muted">
              Your Telegram session is encrypted on your server; files stay in your private channel.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
