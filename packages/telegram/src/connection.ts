import { randomUUID } from "node:crypto";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
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
import { CHANNEL_LOGO_PNG_BASE64 } from "./brand/channel-logo";

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

/** A QR sign-in in progress: a connected client waiting for the phone to approve the token. */
interface QrFlow {
  client: TelegramClient;
  createdAt: number;
  /** Set once the approval update arrives, so the next poll completes the login. */
  approved: boolean;
  /** Set when the account needs its two-factor password before sign-in completes. */
  needsPassword: boolean;
  /** Pending error from the background wait, reported on the next poll. */
  failure: string | null;
}

export interface QrLoginToken {
  /** The `tg://login?token=…` link to render as a QR code. */
  url: string;
  /** Unix time in milliseconds when this token stops being valid. */
  expiresAt: number;
}

export type QrStatus =
  | { status: "waiting"; token: QrLoginToken }
  | { status: "approved"; user: UserRecord }
  | { status: "password_required" }
  | { status: "expired" };

const QR_FLOW_TTL_MS = 5 * 60 * 1000;
const QR_APPROVAL_POLL_MS = 2_000;

export type VerifyCodeResult = { status: "ok"; user: UserRecord } | { status: "password_required" };

/**
 * Orchestrates the full Telegram account connection flow:
 * phone → code (→ 2FA password) → session persisted → user upserted →
 * private storage channel created.
 */
export class TelegramConnectionService {
  private flows = new Map<string, LoginFlow>();
  private qrFlows = new Map<string, QrFlow>();

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

  /**
   * Starts a QR sign-in. Returns a flow id and the first login token. The phone
   * approves the token in the Telegram app; `pollQrLogin` reports the result.
   */
  async startQrLogin(): Promise<{ flowId: string; token: QrLoginToken }> {
    this.sweepExpiredQrFlows();
    const client = newTelegramClient(this.credentials);
    try {
      await client.connect();
      const flow: QrFlow = {
        client,
        createdAt: Date.now(),
        approved: false,
        needsPassword: false,
        failure: null,
      };
      const flowId = randomUUID();
      const token = await this.exportQrToken(client);
      this.qrFlows.set(flowId, flow);
      this.watchQrApproval(flowId, flow);
      return { flowId, token };
    } catch (error) {
      await this.disconnectQuietly(client);
      throw mapTelegramError(error, "Could not start Telegram QR sign-in");
    }
  }

  /**
   * Reports where a QR sign-in stands. While waiting, returns a fresh token
   * (Telegram rotates them every few seconds). On approval, completes the login.
   */
  async pollQrLogin(flowId: string): Promise<QrStatus> {
    const flow = this.requireQrFlow(flowId);
    if (flow.failure) {
      this.qrFlows.delete(flowId);
      await this.disconnectQuietly(flow.client);
      throw new TelegramConnectionError(flow.failure);
    }
    if (flow.needsPassword) return { status: "password_required" };
    if (!flow.approved) {
      const token = await this.exportQrToken(flow.client).catch((error: unknown) => {
        this.qrFlows.delete(flowId);
        void this.disconnectQuietly(flow.client);
        throw mapTelegramError(error, "Could not refresh the Telegram QR code");
      });
      return { status: "waiting", token };
    }
    return this.completeQrLogin(flowId, flow);
  }

  /** Completes a QR sign-in for an account with two-factor authentication. */
  async submitQrPassword(
    flowId: string,
    password: string,
  ): Promise<{ status: "approved"; user: UserRecord }> {
    const flow = this.requireQrFlow(flowId);
    try {
      const passwordInfo = await flow.client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(passwordInfo, password);
      await flow.client.invoke(new Api.auth.CheckPassword({ password: check }));
    } catch (error) {
      throw mapTelegramError(error, "Telegram sign-in failed");
    }
    return this.completeQrLogin(flowId, flow);
  }

  private async exportQrToken(client: TelegramClient): Promise<QrLoginToken> {
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: this.credentials.apiId,
        apiHash: this.credentials.apiHash,
        exceptIds: [],
      }),
    );
    if (!(result instanceof Api.auth.LoginToken)) {
      throw new TelegramConnectionError("Telegram did not issue a QR login token");
    }
    const tokenBase64 = Buffer.from(result.token).toString("base64url");
    return {
      url: `tg://login?token=${tokenBase64}`,
      expiresAt: result.expires * 1000,
    };
  }

  /** Waits for the phone to approve the token, then marks the flow approved. */
  private watchQrApproval(flowId: string, flow: QrFlow): void {
    const timer = setInterval(() => {
      if (Date.now() - flow.createdAt > QR_FLOW_TTL_MS) {
        clearInterval(timer);
        this.qrFlows.delete(flowId);
        void this.disconnectQuietly(flow.client);
        return;
      }
      if (flow.approved || flow.needsPassword || flow.failure) {
        clearInterval(timer);
        return;
      }
      this.probeQrApproval(flow).then(
        (state) => {
          if (state === "approved") {
            flow.approved = true;
            clearInterval(timer);
          } else if (state === "password") {
            flow.needsPassword = true;
            clearInterval(timer);
          }
        },
        (error: unknown) => {
          flow.failure = mapTelegramError(error, "Telegram QR sign-in failed").message;
          clearInterval(timer);
        },
      );
    }, QR_APPROVAL_POLL_MS);
    timer.unref();
  }

  /**
   * Asks Telegram whether the token was approved. Approval is observed by
   * `ExportLoginToken` returning `LoginTokenSuccess` (or a DC migration).
   */
  private async probeQrApproval(flow: QrFlow): Promise<"pending" | "approved" | "password"> {
    try {
      const result = await flow.client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: this.credentials.apiId,
          apiHash: this.credentials.apiHash,
          exceptIds: [],
        }),
      );
      if (result instanceof Api.auth.LoginTokenSuccess) return "approved";
      if (result instanceof Api.auth.LoginTokenMigrateTo) {
        await flow.client._switchDC(result.dcId);
        const migrated = await flow.client.invoke(
          new Api.auth.ImportLoginToken({ token: result.token }),
        );
        if (migrated instanceof Api.auth.LoginTokenSuccess) return "approved";
      }
      return "pending";
    } catch (error) {
      if (isPasswordRequiredError(error)) return "password";
      throw error;
    }
  }

  private async completeQrLogin(
    flowId: string,
    flow: QrFlow,
  ): Promise<{ status: "approved"; user: UserRecord }> {
    this.qrFlows.delete(flowId);
    const user = await this.finalizeConnectedClient(flow.client, null);
    return { status: "approved", user };
  }

  private requireQrFlow(flowId: string): QrFlow {
    const flow = this.qrFlows.get(flowId);
    if (!flow) {
      throw new NotFoundError("This Telegram QR sign-in has ended. Start again.");
    }
    if (Date.now() - flow.createdAt > QR_FLOW_TTL_MS) {
      this.qrFlows.delete(flowId);
      void this.disconnectQuietly(flow.client);
      throw new ValidationError("The QR sign-in expired. Start again.");
    }
    return flow;
  }

  private sweepExpiredQrFlows(): void {
    const now = Date.now();
    for (const [flowId, flow] of this.qrFlows) {
      if (now - flow.createdAt > QR_FLOW_TTL_MS) {
        this.qrFlows.delete(flowId);
        void this.disconnectQuietly(flow.client);
      }
    }
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

    await this.brandChannel(client, channel);

    return this.repos.storages.create({
      userId,
      provider: TELEGRAM_PROVIDER,
      title: channel.title ?? "OmniCloud Storage",
      telegramChatId: channel.id.toString(),
      telegramAccessHash: accessHash,
    });
  }

  /**
   * Sets the OmniCloud logo as the channel photo and moves the channel to the
   * archive folder. Both are cosmetic: a failure is reported in the result and
   * never blocks the storage record.
   */
  private async brandChannel(
    client: TelegramClient,
    channel: Api.Channel,
  ): Promise<{ logo: boolean; archived: boolean }> {
    const result = { logo: false, archived: false };
    const peer = new Api.InputChannel({
      channelId: channel.id,
      accessHash: channel.accessHash!,
    });

    try {
      const file = await client.uploadFile({
        file: new CustomFile(
          "omnicloud.png",
          Buffer.from(CHANNEL_LOGO_PNG_BASE64, "base64").byteLength,
          "",
          Buffer.from(CHANNEL_LOGO_PNG_BASE64, "base64"),
        ),
        workers: 1,
      });
      await client.invoke(
        new Api.channels.EditPhoto({
          channel: peer,
          photo: new Api.InputChatUploadedPhoto({ file }),
        }),
      );
      result.logo = true;
    } catch {
      /* the logo is cosmetic: the channel still works without it */
    }

    try {
      await client.invoke(
        new Api.folders.EditPeerFolders({
          folderPeers: [
            new Api.InputFolderPeer({
              peer: new Api.InputPeerChannel({
                channelId: channel.id,
                accessHash: channel.accessHash!,
              }),
              folderId: 1,
            }),
          ],
        }),
      );
      result.archived = true;
    } catch {
      /* archiving is cosmetic: the channel still works when not archived */
    }

    return result;
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
    const user = await this.finalizeConnectedClient(flow.client, flow.phone);
    return { status: "ok", user };
  }

  /**
   * Saves an authorized client's session, upserts the user and creates storage.
   * `phone` is the number the user typed; QR sign-in passes null and relies on
   * the number Telegram reports.
   */
  private async finalizeConnectedClient(
    client: TelegramClient,
    phone: string | null,
  ): Promise<UserRecord> {
    let stringSession: string;
    let user: UserRecord;
    try {
      stringSession = client.session.save() as unknown as string;
      const me = await client.getMe();
      if (!(me instanceof Api.User)) {
        throw new Error("Telegram did not return the authenticated user");
      }
      user = await this.repos.users.upsertFromTelegram({
        telegramUserId: me.id.toString(),
        username: me.username ?? null,
        firstName: me.firstName ?? null,
        lastName: me.lastName ?? null,
        phone: me.phone ?? phone ?? "",
      });
    } catch (error) {
      await this.disconnectQuietly(client);
      throw mapTelegramError(error, "Could not complete the Telegram connection");
    }

    await this.repos.sessions.save(user.id, stringSession);
    await this.ensureStorageForClient(user.id, client);
    this.clientManager.cacheClient(user.id, client);

    return user;
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
