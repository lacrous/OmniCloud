import { Api, TelegramClient } from "telegram";
import { computeCheck } from "telegram/Password.js";
import {
  NotFoundError,
  TelegramConnectionError,
  ValidationError,
  type Repos,
  type StorageRecord,
  type UserRecord,
} from "@omnicloud/core";
import {
  extractCreatedChannel,
  newTelegramClient,
  type TelegramClientManager,
  type TelegramCredentials,
} from "./client";
import { isPasswordRequiredError, mapTelegramError } from "./errors";

export const TELEGRAM_PROVIDER = "telegram";

/**
 * A Telegram login in progress: a connected client waiting for the
 * confirmation code (and possibly the 2FA password) to be supplied.
 */
interface LoginFlow {
  phone: string;
  client: TelegramClient;
  phoneCodeHash: string;
  createdAt: number;
}

const LOGIN_FLOW_TTL_MS = 5 * 60 * 1000;

export type VerifyCodeResult = { status: "ok"; user: UserRecord } | { status: "password_required" };

/**
 * Orchestrates the full Telegram account connection flow:
 * phone → code (→ 2FA password) → session persisted → user upserted →
 * private storage channel created.
 */
export class TelegramConnectionService {
  private flows = new Map<string, LoginFlow>();

  constructor(
    private readonly repos: Repos,
    private readonly clientManager: TelegramClientManager,
    private readonly credentials: TelegramCredentials,
  ) {}

  /** Sends the Telegram confirmation code for the phone number. */
  async startLogin(phone: string): Promise<void> {
    this.sweepExpiredFlows();
    await this.cancelLogin(phone);

    const client = newTelegramClient(this.credentials);
    try {
      await client.connect();
      const { phoneCodeHash } = await client.sendCode(
        { apiId: this.credentials.apiId, apiHash: this.credentials.apiHash },
        phone,
      );
      this.flows.set(phone, { phone, client, phoneCodeHash, createdAt: Date.now() });
    } catch (error) {
      await this.disconnectQuietly(client);
      throw mapTelegramError(error, "Could not send the Telegram confirmation code");
    }
  }

  /** Verifies the confirmation code. Returns `password_required` for 2FA accounts. */
  async verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
    const flow = this.requireFlow(phone);
    try {
      await flow.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: flow.phone,
          phoneCodeHash: flow.phoneCodeHash,
          phoneCode: code,
        }),
      );
    } catch (error) {
      if (isPasswordRequiredError(error)) {
        return { status: "password_required" };
      }
      throw mapTelegramError(error, "Telegram sign-in failed");
    }
    return this.finalizeLogin(flow);
  }

  /** Completes sign-in for accounts with two-factor authentication enabled. */
  async verifyPassword(phone: string, password: string): Promise<VerifyCodeResult> {
    const flow = this.requireFlow(phone);
    try {
      const passwordInfo = await flow.client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(passwordInfo, password);
      await flow.client.invoke(new Api.auth.CheckPassword({ password: check }));
    } catch (error) {
      throw mapTelegramError(error, "Telegram sign-in failed");
    }
    return this.finalizeLogin(flow);
  }

  /** Aborts a pending login flow (disconnects the client). */
  async cancelLogin(phone: string): Promise<void> {
    const flow = this.flows.get(phone);
    if (flow) {
      this.flows.delete(phone);
      await this.disconnectQuietly(flow.client);
    }
  }

  /**
   * Ensures the user has a registered private storage channel, creating it
   * on first use. Idempotent.
   */
  async ensureStorage(userId: string): Promise<StorageRecord> {
    const existing = await this.repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
    if (existing) return existing;

    const client = await this.clientManager.getForUser(userId);
    return this.ensureStorageForClient(userId, client);
  }

  async ensureStorageForClient(userId: string, client: TelegramClient): Promise<StorageRecord> {
    const existing = await this.repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
    if (existing) return existing;

    let channel: Api.Channel;
    try {
      const result = await client.invoke(
        new Api.channels.CreateChannel({
          title: "OmniCloud Storage",
          about:
            "Private storage channel created by OmniCloud (https://github.com/Lacrous/OmniCloud)",
          megagroup: false,
        }),
      );
      channel = extractCreatedChannel(result);
    } catch (error) {
      throw mapTelegramError(error, "Could not create the private storage channel");
    }

    const accessHash = channel.accessHash?.toString();
    if (!accessHash) {
      throw new TelegramConnectionError("Telegram did not provide the channel access hash");
    }

    return this.repos.storages.create({
      userId,
      provider: TELEGRAM_PROVIDER,
      title: channel.title ?? "OmniCloud Storage",
      telegramChatId: channel.id.toString(),
      telegramAccessHash: accessHash,
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private requireFlow(phone: string): LoginFlow {
    const flow = this.flows.get(phone);
    if (!flow) {
      throw new NotFoundError("No pending Telegram login for this phone number");
    }
    if (Date.now() - flow.createdAt > LOGIN_FLOW_TTL_MS) {
      this.flows.delete(phone);
      void this.disconnectQuietly(flow.client);
      throw new ValidationError("The login session expired — please start again");
    }
    return flow;
  }

  private async finalizeLogin(flow: LoginFlow): Promise<VerifyCodeResult> {
    this.flows.delete(flow.phone);

    let stringSession: string;
    let user: UserRecord;
    try {
      stringSession = flow.client.session.save() as unknown as string;
      const me = await flow.client.getMe();
      if (!(me instanceof Api.User)) {
        throw new Error("Telegram did not return the authenticated user");
      }
      user = await this.repos.users.upsertFromTelegram({
        telegramUserId: me.id.toString(),
        username: me.username ?? null,
        firstName: me.firstName ?? null,
        lastName: me.lastName ?? null,
        phone: me.phone ?? flow.phone,
      });
    } catch (error) {
      await this.disconnectQuietly(flow.client);
      throw mapTelegramError(error, "Could not complete the Telegram connection");
    }

    await this.repos.sessions.save(user.id, stringSession);
    await this.ensureStorageForClient(user.id, flow.client);
    this.clientManager.cacheClient(user.id, flow.client);

    return { status: "ok", user };
  }

  private sweepExpiredFlows(): void {
    const now = Date.now();
    for (const [phone, flow] of this.flows) {
      if (now - flow.createdAt > LOGIN_FLOW_TTL_MS) {
        this.flows.delete(phone);
        void this.disconnectQuietly(flow.client);
      }
    }
  }

  private async disconnectQuietly(client: TelegramClient): Promise<void> {
    try {
      await client.disconnect();
    } catch {
      // best effort
    }
  }
}
