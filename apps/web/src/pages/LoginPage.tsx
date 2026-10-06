import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { useMe } from "../hooks/useMe";
import { ME_QUERY_KEY } from "../lib/queries";
import { CloudIcon, Spinner } from "../components/icons";

type Step = "phone" | "code" | "password";

const CODE_PATTERN = /^\d{3,10}$/;

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
      <p role="alert" className="mt-3 text-sm text-red-600">
        {error}
      </p>
    ) : null;

  const preparingText = preparing ? (
    <p role="status" className="mt-3 flex items-center gap-2 text-sm text-gray-500">
      <Spinner className="h-4 w-4 text-indigo-600" />
      Preparing your private storage…
    </p>
  ) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <CloudIcon className="h-8 w-8 text-indigo-600" />
          <span className="text-xl font-semibold tracking-tight text-gray-900">OmniCloud</span>
        </div>

        <div className="oc-card p-6 shadow-sm">
          {step === "phone" ? (
            <form onSubmit={submitPhone} noValidate>
              <h1 className="text-base font-semibold text-gray-900">Sign in with Telegram</h1>
              <p className="mt-1 text-sm text-gray-500">
                Enter your phone number to receive a login code.
              </p>
              <label htmlFor="login-phone" className="mt-4 block text-sm font-medium text-gray-700">
                Phone number
              </label>
              <input
                id="login-phone"
                type="tel"
                autoComplete="tel"
                placeholder="+15551234567"
                value={phone}
                disabled={busy}
                onChange={(event) => setPhone(event.target.value)}
                className="oc-input mt-1.5"
              />
              {errorText}
              <button
                type="submit"
                className="oc-btn-primary mt-4 w-full"
                disabled={busy || phone.trim() === ""}
              >
                {startMutation.isPending ? "Sending code…" : "Continue"}
              </button>
            </form>
          ) : step === "code" ? (
            <form onSubmit={submitCode} noValidate>
              <h1 className="text-base font-semibold text-gray-900">Enter the code</h1>
              <p className="mt-1 text-sm text-gray-500">
                Enter the code Telegram sent to{" "}
                <span className="font-medium text-gray-700">{phone}</span>.
              </p>
              <label htmlFor="login-code" className="mt-4 block text-sm font-medium text-gray-700">
                Login code
              </label>
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
                className="oc-input mt-1.5 tracking-[0.3em]"
              />
              {errorText}
              {preparingText}
              <button
                type="submit"
                className="oc-btn-primary mt-4 w-full"
                disabled={busy || code.trim() === ""}
              >
                {verifyMutation.isPending ? "Verifying…" : "Verify"}
              </button>
              <button
                type="button"
                onClick={backToPhone}
                disabled={busy}
                className="mt-2 w-full rounded px-1 py-1 text-sm text-gray-500 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none disabled:opacity-60"
              >
                Use a different number
              </button>
            </form>
          ) : (
            <form onSubmit={submitPassword} noValidate>
              <h1 className="text-base font-semibold text-gray-900">Two-factor password</h1>
              <p className="mt-1 text-sm text-gray-500">
                Your Telegram account is protected with a cloud password.
              </p>
              <label
                htmlFor="login-password"
                className="mt-4 block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                className="oc-input mt-1.5"
              />
              {errorText}
              {preparingText}
              <button
                type="submit"
                className="oc-btn-primary mt-4 w-full"
                disabled={busy || password === ""}
              >
                {passwordMutation.isPending || finishing ? "Signing in…" : "Sign in"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("code");
                  setPassword("");
                  setError(null);
                }}
                disabled={busy}
                className="mt-2 w-full rounded px-1 py-1 text-sm text-gray-500 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none disabled:opacity-60"
              >
                Back to the code
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-gray-500">
          OmniCloud uses your Telegram account as its storage backend. Files are stored in a private
          Telegram channel that is created automatically.
        </p>
      </div>
    </main>
  );
}
