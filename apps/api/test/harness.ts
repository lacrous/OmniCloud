import type { FastifyInstance } from "fastify";
import type { UserRecord } from "@omnicloud/core";
import { StorageEngine } from "@omnicloud/core";
import { TELEGRAM_PROVIDER } from "@omnicloud/telegram";
import type { Container, ConnectionService, StorageHealthService } from "../src/container";
import { buildContainerFromRepos } from "../src/container";
import type { AppConfig } from "../src/config";
import { createApp } from "../src/app";
import { FakeStorageProvider, createInMemoryRepos, type InMemoryRepos } from "./repos";

export function testConfig(): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    logLevel: "error",
    nodeEnv: "test",
    sessionSecret: "test-secret",
    cookieSecure: false,
    telegramApiId: 12345,
    telegramApiHash: "test-hash",
    maxUploadBytes: 1024 * 1024,
    webDistDir: null,
    allowedOrigins: [],
    quotaBytes: null,
    trustProxy: false,
  };
}

/**
 * Telegram connection double: login code "12345" succeeds, "0000" triggers the
 * two-factor password step, anything else is rejected.
 */
export class FakeTelegramConnection implements ConnectionService {
  constructor(private readonly repos: InMemoryRepos) {}

  async startLogin(_phone: string): Promise<void> {}

  async verifyCode(
    phone: string,
    code: string,
  ): Promise<{ status: "ok"; user: UserRecord } | { status: "password_required" }> {
    if (code === "0000") return { status: "password_required" };
    if (code !== "12345") throw new Error("Invalid confirmation code");
    return this.complete(phone);
  }

  async verifyPassword(
    phone: string,
    _password: string,
  ): Promise<{ status: "ok"; user: UserRecord }> {
    return this.complete(phone);
  }

  async ensureStorage(userId: string) {
    const existing = await this.repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
    if (existing) return existing;
    return this.repos.storages.create({
      userId,
      provider: TELEGRAM_PROVIDER,
      title: "OmniCloud Storage",
      telegramChatId: "-1001234567890",
      telegramAccessHash: "987654321",
    });
  }

  private async complete(phone: string) {
    const telegramUserId = phone.replace(/\D/g, "") || "424242";
    const user = await this.repos.users.upsertFromTelegram({
      telegramUserId,
      username: `user_${telegramUserId.slice(-4)}`,
      firstName: "Test",
      lastName: null,
      phone,
    });
    await this.ensureStorage(user.id);
    return { status: "ok" as const, user };
  }
}

/** Storage health double that reflects the fake provider. */
export class FakeStorageHealth implements StorageHealthService {
  constructor(private readonly provider: FakeStorageProvider) {}

  async health(_userId: string, _deep = false) {
    const result = await this.provider.healthCheck();
    return { ...result, state: result.healthy ? "CONNECTED" : "ERROR" };
  }

  async disconnect(_userId: string): Promise<void> {}
}

export interface TestHarness {
  app: FastifyInstance;
  container: Container;
  provider: FakeStorageProvider;
  repos: InMemoryRepos;
  /** Performs a fake Telegram login and returns the session cookie value. */
  login(phone?: string): Promise<string>;
}

/** Builds the Fastify app wired to in-memory repos, a fake provider and a fake Telegram connection. */
export async function createTestHarness(): Promise<TestHarness> {
  const repos = createInMemoryRepos();
  const provider = new FakeStorageProvider();

  const container = buildContainerFromRepos(testConfig(), repos, {
    connection: new FakeTelegramConnection(repos),
    storageHealth: new FakeStorageHealth(provider),
    engineFor: async () => new StorageEngine(provider),
  });

  const app = await createApp(container);
  await app.ready();

  return {
    app,
    container,
    provider,
    repos,
    async login(phone = "+15551234567") {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/telegram/verify",
        payload: { phone, code: "12345" },
      });
      if (response.statusCode !== 200) {
        throw new Error(`fake login failed: ${response.statusCode} ${response.body}`);
      }
      const cookie = response.cookies[0];
      if (!cookie) throw new Error("fake login did not set a session cookie");
      return cookie.value;
    },
  };
}

/** Builds a multipart/form-data body without external dependencies. */
export function multipartBody(
  fields: Record<string, string>,
  file: { name: string; data: Buffer },
): { payload: Buffer; contentType: string } {
  const boundary = "----omnicloudtestboundary";
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export { FakeStorageProvider, createInMemoryRepos };
export type { InMemoryRepos };
