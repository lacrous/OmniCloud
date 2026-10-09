import { describe, expect, it } from "vitest";
import { createTestHarness } from "./harness";

describe("no response exposes Telegram session material", () => {
  it("sign-in, identity and storage responses never contain the session string", async () => {
    const h = await createTestHarness();
    const cookie = await h.login("+15550000600");
    const stored = h.repos._sessions[0]?.stringSession ?? "";
    expect(stored.length).toBeGreaterThan(0);
    const responses = [
      await h.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { omnicloud_session: cookie },
      }),
      await h.app.inject({
        method: "GET",
        url: "/api/storage/health",
        cookies: { omnicloud_session: cookie },
      }),
      await h.app.inject({
        method: "GET",
        url: "/api/files",
        cookies: { omnicloud_session: cookie },
      }),
    ];
    for (const res of responses) {
      expect(res.body).not.toContain(stored);
      // Any part of the session secret marker, even inside another field.
      expect(res.body).not.toContain("-secret");
      expect(res.body).not.toContain("fake-telegram-session");
    }
    await h.app.close();
  });

  it("the user record exposes no phone number or Telegram user id", async () => {
    const h = await createTestHarness();
    const cookie = await h.login("+15550000601");
    const me = await h.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { omnicloud_session: cookie },
    });
    const user = me.json().user;
    expect(user).not.toHaveProperty("phone");
    expect(user).not.toHaveProperty("telegramUserId");
    expect(me.body).not.toContain("15550000601");
    await h.app.close();
  });
});
