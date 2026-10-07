/**
 * One row per connection a user makes. It holds NO Garmin tokens and no email: those live only
 * inside the sealed OAuth tokens the client holds. The row exists so codes are single-use, a
 * replayed refresh token can be detected (rotation generation), and a connection can be revoked.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite"; // type only: the module is loaded lazily (Node 18/20 lack it)

export type GrantState = "pending" | "active" | "revoked";

export interface Grant {
  grantId: string;
  userHash: string;
  clientName: string | null;
  state: GrantState;
  generation: number;
  rotatedAt: number | null;
  created: number;
  lastUsed: number;
}

export type GenerationVerdict = "current" | "grace" | "reused" | "missing" | "revoked";
export type RotateResult = { ok: true; generation: number } | { ok: false; reason: "missing" | "revoked" | "reused" };

export const IDLE_LIMIT_S = 35 * 86_400;
export const PENDING_LIMIT_S = 600;
/** Two refreshes racing with the same token (web + mobile, a retry) must not disconnect anyone. */
export const REUSE_GRACE_S = 60;

export const newGrantId = (): string => randomBytes(16).toString("base64url");

export function checkGeneration(grant: Grant | undefined, generation: number, now: number): GenerationVerdict {
  if (!grant) return "missing";
  if (grant.state !== "active") return "revoked";
  if (generation === grant.generation) return "current";
  if (generation === grant.generation - 1 && grant.rotatedAt !== null && now - grant.rotatedAt <= REUSE_GRACE_S) return "grace";
  return "reused";
}

export interface GrantStore {
  create(userHash: string, clientName: string | null, now: number): Grant;
  get(grantId: string): Grant | undefined;
  /** pending → active, once. `false` means the code was already exchanged. */
  activate(grantId: string, now: number): boolean;
  /** Compare-and-bump the refresh generation; a stale one revokes the grant (a replayed refresh token). */
  rotate(grantId: string, generation: number, now: number): RotateResult;
  touch(grantId: string, now: number): void;
  revoke(grantId: string): boolean;
  revokeUser(userHash: string, exceptGrantId?: string): number;
  revokeAll(): number;
  /** Deletes grants idle for 35 days and pending ones older than 10 minutes. */
  purge(now: number): number;
  count(): { active: number; total: number };
  close(): void;
}

/** Shared by both stores: given the verdict, what `rotate` returns and whether to bump. */
function rotation(store: GrantStore, grantId: string, generation: number, now: number, bump: () => void): RotateResult {
  const grant = store.get(grantId);
  const verdict = checkGeneration(grant, generation, now);
  if (verdict === "missing" || verdict === "revoked") return { ok: false, reason: verdict };
  if (verdict === "reused") {
    store.revoke(grantId);
    return { ok: false, reason: "reused" };
  }
  if (verdict === "grace") return { ok: true, generation: grant!.generation };
  bump();
  return { ok: true, generation: generation + 1 };
}

export class MemoryGrantStore implements GrantStore {
  readonly #grants = new Map<string, Grant>();

  create(userHash: string, clientName: string | null, now: number): Grant {
    const grant: Grant = { grantId: newGrantId(), userHash, clientName, state: "pending", generation: 0, rotatedAt: null, created: now, lastUsed: now };
    this.#grants.set(grant.grantId, grant);
    return { ...grant };
  }
  get(grantId: string): Grant | undefined {
    const g = this.#grants.get(grantId);
    return g ? { ...g } : undefined;
  }
  activate(grantId: string, now: number): boolean {
    const g = this.#grants.get(grantId);
    if (g?.state !== "pending") return false;
    g.state = "active";
    g.lastUsed = now;
    return true;
  }
  rotate(grantId: string, generation: number, now: number): RotateResult {
    return rotation(this, grantId, generation, now, () => {
      const g = this.#grants.get(grantId)!;
      g.generation += 1;
      g.rotatedAt = now;
      g.lastUsed = now;
    });
  }
  touch(grantId: string, now: number): void {
    const g = this.#grants.get(grantId);
    if (g) g.lastUsed = now;
  }
  revoke(grantId: string): boolean {
    const g = this.#grants.get(grantId);
    if (!g || g.state === "revoked") return false;
    g.state = "revoked";
    return true;
  }
  revokeUser(userHash: string, exceptGrantId?: string): number {
    let n = 0;
    for (const g of this.#grants.values()) {
      if (g.userHash === userHash && g.grantId !== exceptGrantId && g.state !== "revoked") {
        g.state = "revoked";
        n++;
      }
    }
    return n;
  }
  revokeAll(): number {
    let n = 0;
    for (const g of this.#grants.values()) {
      if (g.state !== "revoked") {
        g.state = "revoked";
        n++;
      }
    }
    return n;
  }
  purge(now: number): number {
    let n = 0;
    for (const [id, g] of this.#grants) {
      if (g.lastUsed < now - IDLE_LIMIT_S || (g.state === "pending" && g.created < now - PENDING_LIMIT_S)) {
        this.#grants.delete(id);
        n++;
      }
    }
    return n;
  }
  count(): { active: number; total: number } {
    const all = [...this.#grants.values()];
    return { active: all.filter((g) => g.state === "active").length, total: all.length };
  }
  close(): void {}
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS grants (
  grant_id TEXT PRIMARY KEY,
  user_hash TEXT NOT NULL,
  client_name TEXT,
  state TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  rotated_at INTEGER,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_user ON grants (user_hash);`;

type Row = Record<string, unknown>;
const toGrant = (r: Row): Grant => {
  const clientName = r["client_name"];
  return {
    grantId: String(r["grant_id"]),
    userHash: String(r["user_hash"]),
    clientName: clientName == null ? null : (clientName as string),
    state: r["state"] as GrantState,
    generation: Number(r["generation"]),
    rotatedAt: r["rotated_at"] == null ? null : Number(r["rotated_at"]),
    created: Number(r["created"]),
    lastUsed: Number(r["last_used"]),
  };
};

export class SqliteGrantStore implements GrantStore {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Needs Node >= 22.13 (`node:sqlite` without a flag); the Docker image has it. */
  static async open(file: string): Promise<SqliteGrantStore> {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    return new SqliteGrantStore(db);
  }

  create(userHash: string, clientName: string | null, now: number): Grant {
    const grant: Grant = { grantId: newGrantId(), userHash, clientName, state: "pending", generation: 0, rotatedAt: null, created: now, lastUsed: now };
    this.#db
      .prepare("INSERT INTO grants (grant_id, user_hash, client_name, state, generation, rotated_at, created, last_used) VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)")
      .run(grant.grantId, userHash, clientName, now, now);
    return grant;
  }
  get(grantId: string): Grant | undefined {
    const row = this.#db.prepare("SELECT * FROM grants WHERE grant_id = ?").get(grantId) as Row | undefined;
    return row ? toGrant(row) : undefined;
  }
  activate(grantId: string, now: number): boolean {
    return Number(this.#db.prepare("UPDATE grants SET state = 'active', last_used = ? WHERE grant_id = ? AND state = 'pending'").run(now, grantId).changes) === 1;
  }
  rotate(grantId: string, generation: number, now: number): RotateResult {
    // node:sqlite is synchronous and single-threaded here, so check-then-update cannot interleave.
    return rotation(this, grantId, generation, now, () => {
      this.#db.prepare("UPDATE grants SET generation = generation + 1, rotated_at = ?, last_used = ? WHERE grant_id = ?").run(now, now, grantId);
    });
  }
  touch(grantId: string, now: number): void {
    this.#db.prepare("UPDATE grants SET last_used = ? WHERE grant_id = ?").run(now, grantId);
  }
  revoke(grantId: string): boolean {
    return Number(this.#db.prepare("UPDATE grants SET state = 'revoked' WHERE grant_id = ? AND state != 'revoked'").run(grantId).changes) === 1;
  }
  revokeUser(userHash: string, exceptGrantId?: string): number {
    return Number(this.#db.prepare("UPDATE grants SET state = 'revoked' WHERE user_hash = ? AND grant_id != ? AND state != 'revoked'").run(userHash, exceptGrantId ?? "").changes);
  }
  revokeAll(): number {
    return Number(this.#db.prepare("UPDATE grants SET state = 'revoked' WHERE state != 'revoked'").run().changes);
  }
  purge(now: number): number {
    return Number(
      this.#db.prepare("DELETE FROM grants WHERE last_used < ? OR (state = 'pending' AND created < ?)").run(now - IDLE_LIMIT_S, now - PENDING_LIMIT_S).changes,
    );
  }
  count(): { active: number; total: number } {
    const r = this.#db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(state = 'active'), 0) AS active FROM grants").get() as Row;
    return { active: Number(r["active"]), total: Number(r["total"]) };
  }
  close(): void {
    this.#db.close();
  }
}
