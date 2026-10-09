/**
 * Health is reported per component so an operator can see which dependency is
 * failing. Liveness never depends on a dependency: a database outage must not
 * make an orchestrator restart a process that is otherwise able to recover.
 */

export type ComponentState = "healthy" | "unhealthy" | "unknown" | "not_configured";

export interface ComponentCheck {
  name: "database" | "encryption" | "storage";
  state: ComponentState;
  /** Operator-facing reason. Never contains a secret, a session, or a key. */
  detail: string | null;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ComponentCheck[];
}

/**
 * Ready only when the database answers and encryption is configured. Storage is
 * not part of readiness: a user may not have connected Telegram yet, and the API
 * must still serve sign-in and the rest of the app.
 */
export function readiness(checks: ComponentCheck[]): ReadinessReport {
  const required = checks.filter((check) => check.name !== "storage");
  const ready = required.every((check) => check.state === "healthy");
  return { ready, checks };
}

export function encryptionCheck(configured: boolean): ComponentCheck {
  return configured
    ? { name: "encryption", state: "healthy", detail: null }
    : {
        name: "encryption",
        state: "not_configured",
        detail: "OMNICLOUD_ENCRYPTION_KEY is not set; Telegram sessions are stored unsealed",
      };
}
