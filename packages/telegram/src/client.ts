import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { StorageProviderError, UnauthorizedError } from "@omnicloud/core";
import type { SessionRepository } from "@omnicloud/core";
import { mapTelegramError } from "./errors";

export interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

/**
 * Keeps one connected TelegramClient per authenticated user. Clients are
 * restored from the persisted MTProto session string and cached for the
 * lifetime of the process.
 */
export class TelegramClientManager {
  private clients = new Map<string, Promise<TelegramClient>>();

  constructor(
    private readonly credentials: TelegramCredentials,
    private readonly sessions: SessionRepository,
  ) {}

  async getForUser(userId: string): Promise<TelegramClient> {
    const cached = this.clients.get(userId);
    if (cached) {
      try {
        return await cached;
      } catch {
        this.clients.delete(userId); // stale entry — reconnect below
      }
    }

    const session = await this.sessions.get(userId);
    if (!session) {
      throw new UnauthorizedError("Telegram account is not connected");
    }

    const promise = this.connect(session.stringSession);
    this.clients.set(userId, promise);
    try {
      return await promise;
    } catch (error) {
      this.clients.delete(userId);
      throw mapTelegramError(error, "Could not connect to Telegram");
    }
  }

  /** Registers an already-authenticated client (e.g. from the login flow). */
  cacheClient(userId: string, client: TelegramClient): void {
    this.clients.set(userId, Promise.resolve(client));
  }

  async disconnectAll(): Promise<void> {
    for (const [userId, promise] of this.clients) {
      this.clients.delete(userId);
      try {
        const client = await promise;
        await client.disconnect();
      } catch {
        // best effort on shutdown
      }
    }
  }

  private async connect(sessionString: string): Promise<TelegramClient> {
    const client = new TelegramClient(
      new StringSession(sessionString),
      this.credentials.apiId,
      this.credentials.apiHash,
      { connectionRetries: 3 },
    );
    await client.connect();
    return client;
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
  throw new StorageProviderError("Telegram did not return the created storage channel");
}
