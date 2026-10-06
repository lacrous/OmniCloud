import { describe, expect, it } from "vitest";
import { TelegramStorageProvider } from "../src/provider";

/**
 * Isolated integration test against the real Telegram API.
 * Runs ONLY when live credentials are provided — the normal test suite never
 * touches Telegram.
 *
 *   TELEGRAM_API_ID=… TELEGRAM_API_HASH=… \
 *   OMNICLOUD_LIVE_TEST=1 \
 *   OMNICLOUD_LIVE_SESSION=<saved StringSession of a user account> \
 *   OMNICLOUD_LIVE_CHAT_ID=<channel id> OMNICLOUD_LIVE_ACCESS_HASH=<access hash> \
 *   pnpm vitest run test/live-provider.test.ts
 */
const enabled =
  process.env.OMNICLOUD_LIVE_TEST === "1" &&
  !!process.env.TELEGRAM_API_ID &&
  !!process.env.TELEGRAM_API_HASH &&
  !!process.env.OMNICLOUD_LIVE_SESSION &&
  !!process.env.OMNICLOUD_LIVE_CHAT_ID &&
  !!process.env.OMNICLOUD_LIVE_ACCESS_HASH;

describe.skipIf(!enabled)("TelegramStorageProvider (live)", () => {
  it("uploads, downloads and deletes a document", { timeout: 120_000 }, async () => {
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions");

    const client = new TelegramClient(
      new StringSession(process.env.OMNICLOUD_LIVE_SESSION),
      Number(process.env.TELEGRAM_API_ID),
      process.env.TELEGRAM_API_HASH!,
      { connectionRetries: 3 },
    );
    await client.connect();

    const provider = new TelegramStorageProvider(client, {
      chatId: process.env.OMNICLOUD_LIVE_CHAT_ID!,
      accessHash: process.env.OMNICLOUD_LIVE_ACCESS_HASH!,
    });

    const payload = Buffer.from(`omnicloud live test ${Date.now()}`);
    const stored = await provider.put({
      name: "omnicloud-live-test.txt",
      mimeType: "text/plain",
      data: payload,
    });
    expect(stored.messageId).toBeTruthy();

    const downloaded = await provider.get(stored);
    expect(downloaded.equals(payload)).toBe(true);

    expect(await provider.exists(stored)).toBe(true);

    await provider.delete(stored);
    expect(await provider.exists(stored)).toBe(false);

    await client.disconnect();
  });
});
