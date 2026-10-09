import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;

beforeAll(async () => {
  h = await createTestHarness();
});
afterAll(async () => {
  await h.app.close();
});

describe("health probes over HTTP", () => {
  it("liveness answers without any session and reports live", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "live" });
  });

  it("readiness is ready when the database answers and encryption is configured", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
  });

  it("readiness returns 503 with a per-component reason when the database fails", async () => {
    const original = h.repos.users.findById;
    h.repos.users.findById = async () => {
      throw new Error("connection refused");
    };
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/health/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json().ready).toBe(false);
      expect(res.json().checks.find((c: { name: string }) => c.name === "database").state).toBe(
        "unhealthy",
      );
    } finally {
      h.repos.users.findById = original;
    }
  });

  it("liveness keeps answering while the database is down", async () => {
    const original = h.repos.users.findById;
    h.repos.users.findById = async () => {
      throw new Error("connection refused");
    };
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/health/live" });
      expect(res.statusCode).toBe(200);
    } finally {
      h.repos.users.findById = original;
    }
  });

  it("does not leak error text or secrets in the probe output", async () => {
    const original = h.repos.users.findById;
    h.repos.users.findById = async () => {
      throw new Error("postgresql://user:hunter2@db/omnicloud");
    };
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/health/ready" });
      expect(res.body).not.toContain("hunter2");
    } finally {
      h.repos.users.findById = original;
    }
  });
});
