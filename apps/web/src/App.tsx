import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { onUnauthorized } from "./api/client";
import { useMe } from "./hooks/useMe";
import { ME_QUERY_KEY, SIGNED_OUT_SESSION } from "./lib/queries";
import { Spinner } from "./components/icons";
import DrivePage from "./pages/DrivePage";
import LoginPage from "./pages/LoginPage";

function FullPageSpinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex h-dvh items-center justify-center bg-gray-50"
    >
      <Spinner className="h-7 w-7 text-indigo-600" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <FullPageSpinner />;
  if (me.data === undefined || me.data.user === null) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const queryClient = useQueryClient();

  // Any 401 from any endpoint resets the session so the route guard redirects to /login.
  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.setQueryData(ME_QUERY_KEY, SIGNED_OUT_SESSION);
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      }),
    [queryClient],
  );

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DrivePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
