import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { checkGeneration, IDLE_LIMIT_S, loadSqlite, MemoryGrantStore, PENDING_LIMIT_S, purgeSafely, REUSE_GRACE_S, SqliteGrantStore, type GrantStore } from "../../src/http/grants.js";

const sqliteAvailable = loadSqlite() !== null;
const tmpDb = () => path.join(mkdtempSync(path.join(os.tmpdir(), "grants-")), "grants.db");

function contract(name: string, open: () => Promise<GrantStore>) {
  describe(name, () => {
    it("creates pending grants that activate exactly once", async () => {
      const s = await open();
      const g = s.create("u1", "Claude", 100);
      expect(s.get(g.grantId)).toMatchObject({ userHash: "u1", clientName: "Claude", state: "pending", generation: 0, rotatedAt: null });
      expect(s.activate(g.grantId, 101)).toBe(true);
      expect(s.activate(g.grantId, 102)).toBe(false);
      expect(s.get(g.grantId)?.state).toBe("active");
    });

    it("bumps the generation and revokes on a stale one", async () => {
      const s = await open();
      const g = s.create("u1", null, 100);
      s.activate(g.grantId, 100);
      expect(s.rotate(g.grantId, 0, 200)).toEqual({ ok: true, generation: 1 });
      expect(s.rotate(g.grantId, 1, 300)).toEqual({ ok: true, generation: 2 });
      expect(s.rotate(g.grantId, 0, 300 + REUSE_GRACE_S + 1)).toEqual({ ok: false, reason: "reused" });
      expect(s.get(g.grantId)?.state).toBe("revoked");
      expect(s.rotate(g.grantId, 2, 400)).toEqual({ ok: false, reason: "revoked" });
      expect(s.rotate("nope", 0, 400)).toEqual({ ok: false, reason: "missing" });
    });

    it("accepts the previous generation inside the grace window without bumping", async () => {
      const s = await open();
      const g = s.create("u1", null, 100);
      s.activate(g.grantId, 100);
      s.rotate(g.grantId, 0, 200);
      expect(s.rotate(g.grantId, 0, 200 + REUSE_GRACE_S)).toEqual({ ok: true, generation: 1 });
      expect(s.get(g.grantId)).toMatchObject({ state: "active", generation: 1 });
    });

    it("revokes one, all of a user's except one, and all", async () => {
      const s = await open();
      const a = s.create("u1", null, 1), b = s.create("u1", null, 1), c = s.create("u2", null, 1);
      [a, b, c].forEach((g) => s.activate(g.grantId, 1));
      expect(s.revokeUser("u1", b.grantId)).toBe(1);
      expect(s.get(a.grantId)?.state).toBe("revoked");
      expect(s.get(b.grantId)?.state).toBe("active");
      expect(s.revoke(b.grantId)).toBe(true);
      expect(s.revoke(b.grantId)).toBe(false);
      expect(s.count()).toEqual({ active: 1, total: 3 });
      expect(s.revokeAll()).toBe(1);
    });

    it("purges idle grants and abandoned pending ones", async () => {
      const s = await open();
      const now = 10_000_000;
      const idle = s.create("u", null, now - IDLE_LIMIT_S - 10);
      s.activate(idle.grantId, now - IDLE_LIMIT_S - 10);
      const abandoned = s.create("u", null, now - PENDING_LIMIT_S - 10);
      const fresh = s.create("u", null, now);
      s.activate(fresh.grantId, now);
      s.touch(fresh.grantId, now);
      expect(s.purge(now)).toBe(2);
      expect(s.get(idle.grantId)).toBeUndefined();
      expect(s.get(abandoned.grantId)).toBeUndefined();
      expect(s.get(fresh.grantId)).toBeDefined();
    });
  });
}

contract("MemoryGrantStore", async () => new MemoryGrantStore());
describe.skipIf(!sqliteAvailable)("sqlite", () => {
  contract("SqliteGrantStore", () => SqliteGrantStore.open(tmpDb()));
  it("persists across reopen", async () => {
    const file = tmpDb();
    const s = await SqliteGrantStore.open(file);
    const g = s.create("u", "Claude", 5);
    s.close();
    expect((await SqliteGrantStore.open(file)).get(g.grantId)?.clientName).toBe("Claude");
  });
});

describe("purgeSafely", () => {
  it("returns the count, or logs a failure instead of throwing", () => {
    const store = new MemoryGrantStore();
    const lines: Record<string, unknown>[] = [];
    expect(purgeSafely(store, 100, (l) => lines.push(l))).toBe(0);
    store.purge = () => {
      throw new Error("database is locked");
    };
    expect(purgeSafely(store, 100, (l) => lines.push(l))).toBeNull();
    expect(lines).toEqual([{ msg: "purge failed", error: "database is locked" }]);
  });
});

describe("checkGeneration", () => {
  const base = { grantId: "g", userHash: "u", clientName: null, created: 0, lastUsed: 0 };
  it("classifies every case", () => {
    expect(checkGeneration(undefined, 0, 0)).toBe("missing");
    expect(checkGeneration({ ...base, state: "pending", generation: 0, rotatedAt: null }, 0, 0)).toBe("revoked");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 2, 100)).toBe("current");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 1, 100 + REUSE_GRACE_S)).toBe("grace");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 1, 101 + REUSE_GRACE_S)).toBe("reused");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 0, 100)).toBe("reused");
  });
});
