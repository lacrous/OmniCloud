export interface AppConfig {
  port: number;
  logLevel: string;
  nodeEnv: string;
  sessionSecret: string;
  cookieSecure: boolean;
  telegramApiId: number;
  telegramApiHash: string;
  maxUploadBytes: number;
  webDistDir: string | null;
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

  return {
    port: int(env, "PORT", 4000),
    logLevel: optional(env, "LOG_LEVEL", "info"),
    nodeEnv,
    sessionSecret: sessionSecret || "development-only-secret-change-me",
    cookieSecure: optional(env, "COOKIE_SECURE", "false").toLowerCase() === "true",
    telegramApiId,
    telegramApiHash,
    maxUploadBytes: int(env, "MAX_UPLOAD_MB", 256) * 1024 * 1024,
    webDistDir: optional(env, "WEB_DIST_DIR", "") || null,
  };
}
