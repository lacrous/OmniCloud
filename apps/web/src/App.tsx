import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { onUnauthorized } from "./api/client";
import DriveLayout from "./components/DriveLayout";
import { useMe } from "./hooks/useMe";
import { ME_QUERY_KEY, SIGNED_OUT_SESSION } from "./lib/queries";
const DrivePage = lazy(() => import("./pages/DrivePage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RecentPage = lazy(() => import("./pages/RecentPage"));
const StarredPage = lazy(() => import("./pages/StarredPage"));
const StoragePage = lazy(() => import("./pages/StoragePage"));
const TokensPage = lazy(() =>
  import("./pages/TokensPage").then((module) => ({ default: module.TokensPage })),
);
const TrashPage = lazy(() => import("./pages/TrashPage"));
const StorageInit = lazy(() => import("./pages/StorageInit"));

function FullPageSpinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex h-dvh items-center justify-center bg-bg"
    >
      <Loader2 className="h-7 w-7 animate-spin text-gold" aria-hidden="true" />
    </div>
  );
}

/** Requires a signed-in session, and an initialized storage channel. */
function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <FullPageSpinner />;
  if (me.data === undefined || me.data.user === null) return <Navigate to="/" replace />;
  if (me.data.storage === null) return <StorageInit />;
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
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <DriveLayout />
            </RequireAuth>
          }
        >
          <Route path="/drive" element={<DrivePage />} />
          <Route path="/recent" element={<RecentPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/settings/tokens" element={<TokensPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
