import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
  StorageUnavailableError,
  TelegramAuthRequiredError,
  TelegramConnectionError,
  UnauthorizedError,
} from "@omnicloud/core";
import type { ConnectionState, SessionRepository, StorageHealth } from "@omnicloud/core";
import { mapTelegramError } from "./errors";

export interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

interface ManagedConnection {
  client: TelegramClient;
  state: ConnectionState;
  /** In-flight connect/reconnect promise, so callers can await it. */
  pending: Promise<TelegramClient> | null;
  lastError: string | null;
  lastCheckAt: number | null;
  lastCheckOk: boolean | null;
}

export interface ConnectionStatus {
  state: ConnectionState;
  lastError: string | null;
  lastCheckAt: Date | null;
  healthy: boolean | null;
}

/** How long a health probe is cached before re-probing. */
const HEALTH_TTL_MS = 30_000;
/** Minimum gap between reconnect attempts for the same user. */
const RECONNECT_COOLDOWN_MS = 5_000;

/**
 * Owns one Telegram (MTProto) connection per authenticated user and tracks an
 * explicit lifecycle state for each:
 *
 *   DISCONNECTED → CONNECTING → CONNECTED
 *                              ↘ RECONNECTING → CONNECTED
 *                              ↘ ERROR | AUTH_REQUIRED
 *
 * Responsibilities: connect, disconnect, reconnect, validateSession,
 * healthCheck, refreshConnection. Sessions never leave the server.
 */
export class TelegramClientManager {
  private connections = new Map<string, ManagedConnection>();
  private lastReconnectAt = new Map<string, number>();

  constructor(
    private readonly credentials: TelegramCredentials,
    private readonly sessions: SessionRepository,
  ) {}

  /** Returns a connected client, (re)connecting when needed. */
  async getForUser(userId: string): Promise<TelegramClient> {
    const existing = this.connections.get(userId);

    if (existing) {
      if (existing.state === "CONNECTED" && this.isConnected(existing.client)) {
        return existing.client;
      }
      if (existing.pending) return existing.pending;
      if (existing.state === "AUTH_REQUIRED") {
        throw new TelegramAuthRequiredError();
      }
      return this.reconnect(userId, existing);
    }

    return this.connectUser(userId);
  }

  /** Connection status for health reporting and the storage dashboard. */
  statusForUser(userId: string): ConnectionStatus {
    const connection = this.connections.get(userId);
    if (!connection) {
      return { state: "DISCONNECTED", lastError: null, lastCheckAt: null, healthy: null };
    }
    return {
      state: connection.state,
      lastError: connection.lastError,
      lastCheckAt: connection.lastCheckAt ? new Date(connection.lastCheckAt) : null,
      healthy: connection.lastCheckOk,
    };
  }

  /**
   * Probes a user's connection. Cheap by default (connection state only);
   * `deep` performs a real Telegram round-trip to validate the session.
   */
  async healthCheck(userId: string, deep = false): Promise<StorageHealth> {
    const connection = this.connections.get(userId);

    if (!connection) {
      try {
        await this.getForUser(userId);
      } catch (error) {
        const state: ConnectionState =
          error instanceof TelegramAuthRequiredError ? "AUTH_REQUIRED" : "ERROR";
        const current = this.connections.get(userId);
        if (current) current.state = state;
        return {
          healthy: false,
          latencyMs: null,
          message: error instanceof Error ? error.message : "Telegram is not connected",
          targetTitle: null,
        };
      }
    }

    const active = this.connections.get(userId)!;

    if (!deep && active.lastCheckAt && Date.now() - active.lastCheckAt < HEALTH_TTL_MS) {
      return {
        healthy: active.lastCheckOk ?? false,
        latencyMs: null,
        message: active.lastError,
        targetTitle: null,
      };
    }

    const startedAt = Date.now();
    try {
      await active.client.getMe();
      active.lastCheckAt = Date.now();
      active.lastCheckOk = true;
      active.lastError = null;
      active.state = "CONNECTED";
      return {
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: null,
        targetTitle: null,
      };
    } catch (error) {
      const mapped = mapTelegramError(error, "Telegram health check failed");
      active.lastCheckAt = Date.now();
      active.lastCheckOk = false;
      active.lastError = mapped.message;
      active.state =
        mapped instanceof TelegramAuthRequiredError || mapped instanceof UnauthorizedError
          ? "AUTH_REQUIRED"
          : "ERROR";
      return {
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: mapped.message,
        targetTitle: null,
      };
    }
  }

  /** Registers an already-authenticated client (from the login flow). */
  cacheClient(userId: string, client: TelegramClient): void {
    this.connections.set(userId, {
      client,
      state: "CONNECTED",
      pending: null,
      lastError: null,
      lastCheckAt: Date.now(),
      lastCheckOk: true,
    });
  }

  /** Drops a user's connection (e.g. after logout) without touching storage. */
  async disconnectUser(userId: string): Promise<void> {
    const connection = this.connections.get(userId);
    if (!connection) return;
    this.connections.delete(userId);
    try {
      await connection.client.disconnect();
    } catch {
      // best effort
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = [...this.connections.keys()];
    await Promise.all(ids.map((userId) => this.disconnectUser(userId)));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private isConnected(client: TelegramClient): boolean {
    try {
      return client.connected === true;
    } catch {
      return false;
    }
  }

  private async connectUser(userId: string): Promise<TelegramClient> {
    const session = await this.sessions.get(userId);
    if (!session) {
      throw new TelegramAuthRequiredError("Telegram account is not connected");
    }

    const connection: ManagedConnection = {
      client: null as unknown as TelegramClient,
      state: "CONNECTING",
      pending: null,
      lastError: null,
      lastCheckAt: null,
      lastCheckOk: null,
    };

    const attempt = this.establish(session.stringSession).then((client) => {
      connection.client = client;
      connection.state = "CONNECTED";
      connection.pending = null;
      connection.lastError = null;
      return client;
    });
    connection.pending = attempt;
    this.connections.set(userId, connection);

    try {
      return await attempt;
    } catch (error) {
      connection.pending = null;
      const mapped = mapTelegramError(error, "Could not connect to Telegram");
      connection.state =
        mapped instanceof TelegramAuthRequiredError || mapped instanceof UnauthorizedError
          ? "AUTH_REQUIRED"
          : "ERROR";
      connection.lastError = mapped.message;
      throw mapped;
    }
  }

  private async reconnect(userId: string, connection: ManagedConnection): Promise<TelegramClient> {
    const lastAttempt = this.lastReconnectAt.get(userId) ?? 0;
    if (Date.now() - lastAttempt < RECONNECT_COOLDOWN_MS && connection.pending) {
      return connection.pending;
    }
    this.lastReconnectAt.set(userId, Date.now());

    connection.state = "RECONNECTING";
    const session = await this.sessions.get(userId);
    if (!session) {
      connection.state = "AUTH_REQUIRED";
      throw new TelegramAuthRequiredError("Telegram account is not connected");
    }

    const attempt = (async () => {
      try {
        await connection.client.disconnect().catch(() => undefined);
      } catch {
        // ignore
      }
      return this.establish(session.stringSession);
    })()
      .then((client) => {
        connection.client = client;
        connection.state = "CONNECTED";
        connection.pending = null;
        connection.lastError = null;
        return client;
      })
      .catch((error: unknown) => {
        connection.pending = null;
        const mapped = mapTelegramError(error, "Could not reconnect to Telegram");
        connection.state =
          mapped instanceof TelegramAuthRequiredError || mapped instanceof UnauthorizedError
            ? "AUTH_REQUIRED"
            : "ERROR";
        connection.lastError = mapped.message;
        throw mapped;
      });

    connection.pending = attempt;
    return attempt;
  }

  private async establish(sessionString: string): Promise<TelegramClient> {
    const client = new TelegramClient(
      new StringSession(sessionString),
      this.credentials.apiId,
      this.credentials.apiHash,
      { connectionRetries: 3 },
    );
    try {
      await client.connect();
      // Validate the session immediately so expired sessions surface as
      // AUTH_REQUIRED instead of a generic failure on the first operation.
      if (!client.connected) {
        throw new TelegramConnectionError("Telegram client did not connect");
      }
      return client;
    } catch (error) {
      throw mapTelegramError(error, "Could not connect to Telegram");
    }
  }
}

export function newTelegramClient(credentials: TelegramCredentials): TelegramClient {
  return new TelegramClient(new StringSession(""), credentials.apiId, credentials.apiHash, {
    connectionRetries: 3,
  });
}

/**
 * Extracts the freshly created broadcast channel from a
 * channels.CreateChannel response.
 */
export function extractCreatedChannel(result: Api.TypeUpdates): Api.Channel {
  const chats =
    result instanceof Api.Updates || result instanceof Api.UpdatesCombined ? result.chats : [];
  for (const chat of chats) {
    if (chat instanceof Api.Channel) return chat;
  }
  throw new TelegramConnectionError("Telegram did not return the created storage channel");
}

export { StorageUnavailableError };
