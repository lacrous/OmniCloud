/**
 * Paths whose values must never reach a log line. Pino replaces them with
 * "[Redacted]". This is a backstop: code should not log these in the first place.
 *
 * The list covers what this project actually handles: browser and Telegram
 * sessions, the encryption and session secrets, Telegram login codes and
 * two-factor passwords, and request credentials.
 */
const SECRET_KEYS = [
  "stringSession",
  "session",
  "cookie",
  "password",
  "code",
  "token",
  "tokenHash",
  "encryptionKey",
  "sessionSecret",
  "OMNICLOUD_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "TELEGRAM_API_HASH",
];

/**
 * Each secret key is matched at the top level of a log object and one level
 * down, so a field is masked whether it is logged directly or inside an object.
 */
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
];

export const LOGGER_OPTIONS = (level: string) => ({
  level,
  redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
});
