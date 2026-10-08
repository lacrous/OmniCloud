export interface AppConfig {
  /** Key that seals Telegram sessions at rest. Null only outside production. */
  encryptionKey: string | null;
  port: number;
  host: string;
  logLevel: string;
  nodeEnv: string;
  sessionSecret: string;
  cookieSecure: boolean;
  telegramApiId: number;
  telegramApiHash: string;
  maxUploadBytes: number;
  webDistDir: string | null;
  /** Explicit CORS/CSRF origin allowlist; empty = same-origin only. */
  allowedOrigins: string[];
  /** Optional storage quota shown on the dashboard (null = unlimited). */
  quotaBytes: number | null;
  trustProxy: boolean;
}

function optional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (!raw || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const telegramApiId = int(env, "TELEGRAM_API_ID", 0);
  const telegramApiHash = optional(env, "TELEGRAM_API_HASH", "");
  if (telegramApiId === 0 || !telegramApiHash) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH are required. Create an application at https://my.telegram.org (see .env.example).",
    );
  }

  const nodeEnv = optional(env, "NODE_ENV", "development");
  const sessionSecret = optional(env, "SESSION_SECRET", "");
  if (!sessionSecret && nodeEnv === "production") {
    throw new Error("SESSION_SECRET must be set when NODE_ENV=production");
  }

  const encryptionKey = optional(env, "OMNICLOUD_ENCRYPTION_KEY", "");
  if (!encryptionKey && nodeEnv === "production") {
    throw new Error("OMNICLOUD_ENCRYPTION_KEY must be set when NODE_ENV=production");
  }

  const quotaGb = Number(optional(env, "STORAGE_QUOTA_GB", "0"));

  return {
    encryptionKey: encryptionKey || null,
    port: int(env, "PORT", 4000),
    host: optional(env, "HOST", "0.0.0.0"),
    logLevel: optional(env, "LOG_LEVEL", "info"),
    nodeEnv,
    sessionSecret: sessionSecret || "development-only-secret-change-me",
    cookieSecure: bool(env, "COOKIE_SECURE", false),
    telegramApiId,
    telegramApiHash,
    maxUploadBytes: int(env, "MAX_UPLOAD_MB", 256) * 1024 * 1024,
    webDistDir: optional(env, "WEB_DIST_DIR", "") || null,
    allowedOrigins: optional(env, "ALLOWED_ORIGINS", "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    quotaBytes: Number.isFinite(quotaGb) && quotaGb > 0 ? Math.round(quotaGb * 1024 ** 3) : null,
    trustProxy: bool(env, "TRUST_PROXY", false),
  };
}
