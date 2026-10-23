/**
 * One row per connection a user makes. It holds NO Garmin tokens and no email: those live only
 * inside the sealed OAuth tokens the client holds. The row exists so codes are single-use, a
 * replayed refresh token can be detected (rotation generation), and a connection can be revoked.
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite"; // type only: the module is loaded lazily (Node 18/20 lack it)

type Sqlite = typeof import("node:sqlite");

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

/** What the public stats page shows. Counts only: no ids, no hashes, nothing per person. */
export interface UsageCounts {
  /** Distinct people (profile-id hashes) with at least one active connection. */
  users: number;
  /** Active connections; one person on two clients is two. */
  connections: number;
  /** People who used a connection in the last 1 / 7 / 30 days. */
  active1d: number;
  active7d: number;
  active30d: number;
  /** People per client name, most first. Names are whatever each client registered: untrusted. */
  byClient: { client: string | null; users: number }[];
}

/** One row of the daily trend, keyed by UTC date (YYYY-MM-DD). */
export interface DailyCount {
  day: string;
  users: number;
  connections: number;
  active7d: number;
  /** People whose first connection still on record was made that day: new people, not new connections. */
  joined: number;
}

export const utcDay = (now: number): string => new Date(now * 1000).toISOString().slice(0, 10);

/** Days whose `joined` the next snapshot recomputes: today, and yesterday so people who join after a once-a-day snapshot still land on their day. */
const openDays = (now: number): string[] => [utcDay(now - 86_400), utcDay(now)];

export const newGrantId = (): string => randomBytes(16).toString("base64url");

export function checkGeneration(grant: Grant | undefined, generation: number, now: number): GenerationVerdict {
  if (!grant) return "missing";
  if (grant.state !== "active") return "revoked";
  if (generation === grant.generation) return "current";
  if (generation === grant.generation - 1 && grant.rotatedAt !== null && now - grant.rotatedAt <= REUSE_GRACE_S) return "grace";
  return "reused";
}

/** node:sqlite through Node's own require: vite-node cannot import it, and Node < 22.13 has no unflagged module. `null` when unavailable. */
export function loadSqlite(): Sqlite | null {
  try {
    return createRequire(import.meta.url)("node:sqlite") as Sqlite;
  } catch {
    return null;
  }
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
  usage(now: number): UsageCounts;
  /** Upserts today's (UTC) row of the trend from `usage(now)` and settles yesterday's `joined`. Purge never deletes these rows. */
  recordDay(now: number): void;
  /** The trend rows from the last `days` UTC days up to `now`, oldest first. */
  history(now: number, days: number): DailyCount[];
  close(): void;
}

/** A purge that fails (a locked database, a full disk) is logged, not fatal: the next one retries. */
export function purgeSafely(store: GrantStore, now: number, log: (line: Record<string, unknown>) => void): number | null {
  try {
    return store.purge(now);
  } catch (error) {
    log({ msg: "purge failed", error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

const byUsersThenName = (a: { client: string | null; users: number }, b: { client: string | null; users: number }) =>
  b.users - a.users || (a.client === null ? 1 : b.client === null ? -1 : a.client.localeCompare(b.client));

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
  readonly #days = new Map<string, DailyCount>();

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
  usage(now: number): UsageCounts {
    const active = [...this.#grants.values()].filter((g) => g.state === "active");
    const people = (since: number) => new Set(active.filter((g) => g.lastUsed >= since).map((g) => g.userHash)).size;
    const clients = new Map<string | null, Set<string>>();
    for (const g of active) clients.set(g.clientName, (clients.get(g.clientName) ?? new Set()).add(g.userHash));
    return {
      users: people(-Infinity),
      connections: active.length,
      active1d: people(now - 86_400),
      active7d: people(now - 7 * 86_400),
      active30d: people(now - 30 * 86_400),
      byClient: [...clients].map(([client, users]) => ({ client, users: users.size })).sort(byUsersThenName),
    };
  }
  recordDay(now: number): void {
    const u = this.usage(now);
    const day = utcDay(now);
    this.#days.set(day, { day, users: u.users, connections: u.connections, active7d: u.active7d, joined: 0 });
    const first = new Map<string, number>();
    for (const g of this.#grants.values()) if (g.state !== "pending") first.set(g.userHash, Math.min(first.get(g.userHash) ?? Infinity, g.created));
    for (const d of openDays(now)) {
      const row = this.#days.get(d);
      if (row) row.joined = [...first.values()].filter((t) => utcDay(t) === d).length;
    }
  }
  history(now: number, days: number): DailyCount[] {
    const from = utcDay(now - (days - 1) * 86_400), to = utcDay(now);
    return [...this.#days.values()].filter((d) => d.day >= from && d.day <= to).sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d }));
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
CREATE INDEX IF NOT EXISTS grants_user ON grants (user_hash);
CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  users INTEGER NOT NULL,
  connections INTEGER NOT NULL,
  active_7d INTEGER NOT NULL,
  joined INTEGER
);`;

/** People per day of their first connection still on record. Pending grants never finished connecting, so they don't count. */
const JOINED_ON = `(SELECT COUNT(*) FROM (SELECT MIN(created) AS first FROM grants WHERE state != 'pending' GROUP BY user_hash)
  WHERE first >= unixepoch(daily_stats.day) AND first < unixepoch(daily_stats.day) + 86400)`;

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
    const sqlite = loadSqlite();
    if (!sqlite) throw new Error("SQLite needs Node 22.13 or newer (node:sqlite)");
    const db = new sqlite.DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL;");
    // Wait for a lock (e.g. the revoke CLI writing from another process) instead of failing at once.
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA);
    // Rows from before `joined` existed: fill them from the grants still on record (all of them, while the trend is younger than the 35-day purge).
    if (!(db.prepare("PRAGMA table_info(daily_stats)").all() as Row[]).some((c) => c["name"] === "joined")) db.exec("ALTER TABLE daily_stats ADD COLUMN joined INTEGER;");
    db.exec(`UPDATE daily_stats SET joined = ${JOINED_ON} WHERE joined IS NULL;`);
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
  usage(now: number): UsageCounts {
    const r = this.#db
      .prepare(
        `SELECT COUNT(DISTINCT user_hash) AS users, COUNT(*) AS connections,
           COUNT(DISTINCT CASE WHEN last_used >= ? THEN user_hash END) AS d1,
           COUNT(DISTINCT CASE WHEN last_used >= ? THEN user_hash END) AS d7,
           COUNT(DISTINCT CASE WHEN last_used >= ? THEN user_hash END) AS d30
         FROM grants WHERE state = 'active'`,
      )
      .get(now - 86_400, now - 7 * 86_400, now - 30 * 86_400) as Row;
    const clients = this.#db
      .prepare("SELECT client_name, COUNT(DISTINCT user_hash) AS users FROM grants WHERE state = 'active' GROUP BY client_name")
      .all() as Row[];
    return {
      users: Number(r["users"]),
      connections: Number(r["connections"]),
      active1d: Number(r["d1"]),
      active7d: Number(r["d7"]),
      active30d: Number(r["d30"]),
      byClient: clients.map((c) => ({ client: c["client_name"] == null ? null : (c["client_name"] as string), users: Number(c["users"]) })).sort(byUsersThenName),
    };
  }
  recordDay(now: number): void {
    const u = this.usage(now);
    this.#db
      .prepare("INSERT INTO daily_stats (day, users, connections, active_7d) VALUES (?, ?, ?, ?) ON CONFLICT (day) DO UPDATE SET users = excluded.users, connections = excluded.connections, active_7d = excluded.active_7d")
      .run(utcDay(now), u.users, u.connections, u.active7d);
    this.#db.prepare(`UPDATE daily_stats SET joined = ${JOINED_ON} WHERE day IN (?, ?)`).run(...openDays(now));
  }
  history(now: number, days: number): DailyCount[] {
    const rows = this.#db
      .prepare("SELECT day, users, connections, active_7d, joined FROM daily_stats WHERE day >= ? AND day <= ? ORDER BY day")
      .all(utcDay(now - (days - 1) * 86_400), utcDay(now)) as Row[];
    return rows.map((r) => ({ day: String(r["day"]), users: Number(r["users"]), connections: Number(r["connections"]), active7d: Number(r["active_7d"]), joined: Number(r["joined"] ?? 0) }));
  }
  close(): void {
    this.#db.close();
  }
}
