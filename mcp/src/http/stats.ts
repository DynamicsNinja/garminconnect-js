/**
 * The public usage page, /mcp/stats (and /mcp/stats.json). Counts only, from the grants table and
 * the daily_stats trend: no ids, no hashes, nothing about any one person. Client names are chosen
 * by whoever registers a client, so rare ones are folded into "Other" and every name is escaped.
 */
import { escape, loginShell } from "../login-page.js";
import type { GrantStore } from "./grants.js";

/** A client name is shown only once this many people use it; anything rarer could identify someone. */
export const MIN_CLIENT_USERS = 3;
export const TREND_DAYS = 90;

export interface Stats {
  generatedAt: string;
  users: number;
  connections: number;
  active: { day: number; week: number; month: number };
  clients: { name: string; users: number }[];
  daily: { day: string; users: number; connections: number; active7d: number }[];
}

export function foldClients(byClient: { client: string | null; users: number }[]): Stats["clients"] {
  const shown = byClient.filter((c): c is { client: string; users: number } => c.client !== null && c.users >= MIN_CLIENT_USERS);
  const other = byClient.reduce((n, c) => n + (c.client !== null && c.users >= MIN_CLIENT_USERS ? 0 : c.users), 0);
  return [...shown.map((c) => ({ name: c.client, users: c.users })), ...(other > 0 ? [{ name: "Other", users: other }] : [])];
}

export function buildStats(store: GrantStore, now: number): Stats {
  const u = store.usage(now);
  return {
    generatedAt: new Date(now * 1000).toISOString(),
    users: u.users,
    connections: u.connections,
    active: { day: u.active1d, week: u.active7d, month: u.active30d },
    clients: foldClients(u.byClient),
    daily: store.history(now, TREND_DAYS),
  };
}

export function statsHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "cache-control": "public, max-age=300",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

const STYLE = `<style>
main{max-width:560px}footer{max-width:560px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:0 0 20px}
.tile{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.tile b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums}.tile span{font-size:.8rem;color:var(--muted)}
h2{font-size:1rem;margin:20px 0 8px}
table{width:100%;border-collapse:collapse;font-size:.9rem}td{padding:6px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
svg.trend{display:block;width:100%;height:auto;color:var(--accent)}
.axis{display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);margin-top:4px}
.note{font-size:.8rem}
</style>`;

function trend(daily: Stats["daily"]): string {
  if (daily.length === 0) return `<p>The trend starts with the first daily snapshot.</p>`;
  if (daily.length === 1) return `<p>The trend starts on ${escape(daily[0]!.day)}. Come back tomorrow for a line.</p>`;
  const w = 300, h = 100, pad = 4;
  const max = Math.max(1, ...daily.map((d) => d.users));
  const x = (i: number) => (pad + (i * (w - 2 * pad)) / (daily.length - 1)).toFixed(1);
  const y = (v: number) => (h - pad - (v * (h - 2 * pad)) / max).toFixed(1);
  const points = daily.map((d, i) => `${x(i)},${y(d.users)}`).join(" ");
  const first = daily[0]!, last = daily[daily.length - 1]!;
  return `<svg class="trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="People connected per day, from ${fmt(first.users)} on ${escape(first.day)} to ${fmt(last.users)} on ${escape(last.day)}">
<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="currentColor" stroke-opacity=".25" stroke-width="1"/>
<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
</svg><div class="axis"><span>${escape(first.day)}</span><span>peak ${fmt(max)}</span><span>${escape(last.day)}</span></div>`;
}

export function statsPage(s: Stats): string {
  const tile = (value: number, label: string) => `<div class="tile"><b>${fmt(value)}</b><span>${label}</span></div>`;
  const clients = s.clients.length
    ? `<table>${s.clients.map((c) => `<tr><td>${escape(c.name)}</td><td>${fmt(c.users)}</td></tr>`).join("")}</table>`
    : `<p>No one is connected yet.</p>`;
  return loginShell(
    "Garmin MCP usage",
    `${STYLE}<h1>Garmin MCP usage</h1>
<p>People using the hosted Garmin Connect connector. A connection unused for 35 days is removed, so these are people active in the last 35 days.</p>
<div class="tiles">${tile(s.users, "people")}${tile(s.connections, "connections")}${tile(s.active.day, "active today")}${tile(s.active.week, "active this week")}${tile(s.active.month, "active this month")}</div>
<h2>People per client</h2>${clients}
<h2>People connected, last ${TREND_DAYS} days</h2>${trend(s.daily)}
<p class="note" style="margin-top:20px">Counts only: no names, emails or ids. Updated every 5 minutes, as of ${escape(s.generatedAt.slice(0, 16).replace("T", " "))} UTC. Also as <a href="/mcp/stats.json">JSON</a>.</p>`,
  );
}
