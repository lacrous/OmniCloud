import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import type { QrLoginToken } from "../src/connection";

const { client } = vi.hoisted(() => ({
  client: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    invoke: vi.fn(),
    _switchDC: vi.fn(),
  },
}));

vi.mock("../src/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client")>();
  return { ...actual, newTelegramClient: () => client };
});

import { TelegramConnectionService } from "../src/connection";

function makeService() {
  return new TelegramConnectionService(
    { storages: {}, sessions: {}, users: {} } as never,
    {} as never,
    { apiId: 1, apiHash: "hash" },
  );
}

function loginToken() {
  return new Api.auth.LoginToken({ token: Buffer.from("token"), expires: 2_000 });
}

function flow(): {
  client: typeof client;
  createdAt: number;
  approved: boolean;
  needsPassword: boolean;
  failure: string | null;
  tokenRequest: Promise<QrLoginToken | null> | null;
  token: QrLoginToken | null;
} {
  return {
    client,
    createdAt: Date.now(),
    approved: false,
    needsPassword: false,
    failure: null,
    tokenRequest: null,
    token: null,
  };
}

describe("QR login token migration responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.connect.mockResolvedValue(undefined);
    client.disconnect.mockResolvedValue(undefined);
    client._switchDC.mockResolvedValue(undefined);
  });

  it("encodes a LoginToken response as a QR URL", async () => {
    client.invoke.mockResolvedValue(loginToken());
    const service = makeService();
    const token = await (service as any).exportQrToken(client);
    expect(token).toEqual({
      url: `tg://login?token=${Buffer.from("token").toString("base64url")}`,
      expiresAt: 2_000_000,
    });
  });

  it("switches DC and imports migration responses that produce a token", async () => {
    const migration = new Api.auth.LoginTokenMigrateTo({
      dcId: 4,
      token: Buffer.from("migrate"),
    });
    client.invoke.mockResolvedValueOnce(migration).mockResolvedValueOnce(loginToken());
    const token = await (makeService() as any).exportQrToken(client);
    expect(client._switchDC).toHaveBeenCalledWith(4);
    expect(client.invoke.mock.calls[1]?.[0]).toBeInstanceOf(Api.auth.ImportLoginToken);
    expect(token.url).toBe(`tg://login?token=${Buffer.from("token").toString("base64url")}`);
  });

  it("marks a migrated LoginTokenSuccess as approved", async () => {
    const migration = new Api.auth.LoginTokenMigrateTo({
      dcId: 4,
      token: Buffer.from("migrate"),
    });
    const success = new Api.auth.LoginTokenSuccess({
      authorization: new Api.auth.Authorization({
        setupPasswordRequired: false,
        otherwiseReloginDays: 0,
        tmpSessions: 0,
        futureAuthToken: Buffer.from("auth"),
        user: new Api.User({
          id: bigInt(1),
          accessHash: bigInt(1),
          firstName: "Test",
        }),
      }),
    });
    client.invoke.mockResolvedValueOnce(migration).mockResolvedValueOnce(success);
    const approvalFlow = flow();
    const token = await (makeService() as any).exportQrToken(client, approvalFlow);
    expect(token).toBeNull();
    expect(approvalFlow.approved).toBe(true);
    expect(client._switchDC).toHaveBeenCalledWith(4);
  });

  it("treats migrated success during approval probing as approved", async () => {
    const migration = new Api.auth.LoginTokenMigrateTo({
      dcId: 4,
      token: Buffer.from("migrate"),
    });
    const success = new Api.auth.LoginTokenSuccess({
      authorization: new Api.auth.Authorization({
        setupPasswordRequired: false,
        otherwiseReloginDays: 0,
        tmpSessions: 0,
        futureAuthToken: Buffer.from("auth"),
        user: new Api.User({
          id: bigInt(1),
          accessHash: bigInt(1),
          firstName: "Test",
        }),
      }),
    });
    client.invoke.mockResolvedValueOnce(migration).mockResolvedValueOnce(success);
    const approvalFlow = flow();
    const state = await (makeService() as any).probeQrApproval(approvalFlow);
    expect(state).toBe("approved");
  });

  it("shares concurrent token exports so Telegram requests do not overlap", async () => {
    const approvalFlow = flow();
    let resolveExport!: (token: Api.auth.LoginToken) => void;
    client.invoke.mockReturnValueOnce(
      new Promise<Api.auth.LoginToken>((resolve) => {
        resolveExport = resolve;
      }),
    );
    const service = makeService() as any;
    const first = service.exportQrToken(client, approvalFlow);
    const second = service.exportQrToken(client, approvalFlow);
    expect(client.invoke).toHaveBeenCalledOnce();
    resolveExport(loginToken());
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ url: expect.stringMatching(/^tg:\/\/login\?token=/) }),
      expect.objectContaining({ url: expect.stringMatching(/^tg:\/\/login\?token=/) }),
    ]);
    expect(approvalFlow.token).not.toBeNull();
    expect(approvalFlow.tokenRequest).toBeNull();
  });

  it("keeps an existing QR flow alive after a transient polling error", async () => {
    const service = makeService();
    const approvalFlow = flow();
    approvalFlow.token = {
      url: "tg://login?token=old",
      expiresAt: Date.now() + 60_000,
    };
    const id = "flow-transient";
    (service as any).qrFlows.set(id, approvalFlow);
    client.invoke.mockRejectedValueOnce(new Error("TIMEOUT while reconnecting"));
    await expect(service.pollQrLogin(id)).resolves.toEqual({
      status: "waiting",
      token: approvalFlow.token,
    });
    expect((service as any).qrFlows.has(id)).toBe(true);
    expect(client.disconnect).not.toHaveBeenCalled();
    client.invoke.mockResolvedValueOnce(loginToken());
    await expect(service.pollQrLogin(id)).resolves.toMatchObject({ status: "waiting" });
  });

  it("does not stop the approval watcher on a transient transport error", async () => {
    vi.useFakeTimers();
    const service = makeService() as any;
    const approvalFlow = flow();
    approvalFlow.token = { url: "tg://login?token=old", expiresAt: Date.now() + 60_000 };
    service.qrFlows.set("watcher-flow", approvalFlow);
    client.invoke.mockRejectedValueOnce(new Error("TIMEOUT"));
    service.watchQrApproval("watcher-flow", approvalFlow);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(approvalFlow.failure).toBeNull();
    client.invoke.mockResolvedValueOnce(loginToken());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(approvalFlow.token.url).toMatch(/^tg:\/\/login\?token=/);
    vi.useRealTimers();
  });

  it("rejects an immediate success at start without returning a fake token and disconnects", async () => {
    const success = new Api.auth.LoginTokenSuccess({
      authorization: new Api.auth.Authorization({
        setupPasswordRequired: false,
        otherwiseReloginDays: 0,
        tmpSessions: 0,
        futureAuthToken: Buffer.from("auth"),
        user: new Api.User({
          id: bigInt(1),
          accessHash: bigInt(1),
          firstName: "Test",
        }),
      }),
    });
    client.invoke.mockResolvedValue(success);
    await expect(makeService().startQrLogin()).rejects.toThrow(
      "approved QR login before issuing a token",
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
