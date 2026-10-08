import type { ConnectionState, StorageHealthDTO } from "@omnicloud/shared";

export interface HealthVisual {
  /** Tailwind text color utility for the state dot and label. */
  tone: string;
  /** Short human label for the connection state. */
  label: string;
  /** Whether the drive can currently read/write to the backend. */
  usable: boolean;
  /** Optional remediation hint (e.g. reconnect Telegram). */
  hint: string | null;
}

const STATE_LABELS: Record<ConnectionState, string> = {
  DISCONNECTED: "Disconnected",
  CONNECTING: "Connecting",
  CONNECTED: "Connected",
  RECONNECTING: "Reconnecting",
  ERROR: "Connection error",
  AUTH_REQUIRED: "Reconnect required",
};

/**
 * Maps a storage health snapshot to the sidebar's dot color and copy. Green
 * (`text-ok`) when connected and healthy, amber while degraded/working, red
 * (`text-bad`) on errors or when Telegram must be reconnected.
 */
export function healthVisual(health: StorageHealthDTO | null): HealthVisual {
  if (health === null) {
    return { tone: "text-muted", label: "Unknown", usable: false, hint: null };
  }

  const label = STATE_LABELS[health.state];

  if (health.state === "AUTH_REQUIRED") {
    return {
      tone: "text-bad",
      label,
      usable: false,
      hint: health.message ?? "Reconnect Telegram in Settings to keep syncing.",
    };
  }
  if (health.state === "ERROR" || health.status === "unavailable") {
    return {
      tone: "text-bad",
      label,
      usable: false,
      hint: health.message ?? "The storage backend is unavailable right now.",
    };
  }
  if (health.state === "CONNECTED" && health.status === "healthy") {
    return { tone: "text-ok", label, usable: true, hint: null };
  }
  return {
    tone: "text-gold-text",
    label,
    usable:
      health.state === "CONNECTED" ||
      health.state === "CONNECTING" ||
      health.state === "RECONNECTING",
    hint: health.message,
  };
}
