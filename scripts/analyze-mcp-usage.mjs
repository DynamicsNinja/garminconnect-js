#!/usr/bin/env node
/**
 * Per-person usage report for the hosted MCP server, from its JSON-line logs.
 *
 * Input: any mix of month files (`/data/logs/YYYY-MM.jsonl`, or a folder holding them) and the
 * admin export (`/mcp/admin/logs.json?from=…&to=…`, shape `{ lines, truncated }`).
 *
 *   node scripts/analyze-mcp-usage.mjs ./logs
 *   node scripts/analyze-mcp-usage.mjs logs.json --days 30 --heavy 50 --csv usage.csv
 *
 * Only `tools/call` lines count as use, the same rule the /mcp/stats page applies: connecting,
 * listing tools or refreshing a token is not use. People are the 8-char `user` prefix; a line
 * without one borrows it from another line of the same connection (`grant`).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const daysArg = opt("--days");
const days = daysArg ? Number(daysArg) : undefined;
const csvOut = opt("--csv");
const heavyMin = Number(opt("--heavy") ?? 100);
if (args.length === 0) {
  console.error("usage: analyze-mcp-usage.mjs <logs dir | *.jsonl | logs.json>... [--days N] [--heavy N] [--csv out.csv]");
  process.exit(1);
}

function readLines(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().flatMap((f) => readLines(join(path, f)));
  }
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const d = JSON.parse(text);
    if (d.truncated) console.error(`warning: ${path} was truncated by the server (200,000-line cap); narrow the range`);
    return d.lines ?? d;
  }
  return text.split("\n").flatMap((l) => {
    try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; }
  });
}

const lines = args.flatMap(readLines);
const owner = {};
for (const l of lines) if (l.grant && l.user) owner[l.grant] = l.user;

const DAY = 86_400_000;
const latest = Math.max(...lines.map((l) => Date.parse(l.t)).filter(Number.isFinite));
const since = days ? latest - days * DAY : -Infinity;

const people = new Map();
let total = 0;
for (const l of lines) {
  if (l.rpc !== "tools/call") continue;
  const t = Date.parse(l.t);
  if (!Number.isFinite(t) || t < since) continue;
  const who = l.user ?? owner[l.grant] ?? (l.grant ? `grant:${l.grant}` : null);
  if (!who) continue;
  let p = people.get(who);
  if (!p) people.set(who, (p = { who, calls: 0, errors: 0, days: new Set(), weeks: new Set(), grants: new Set(), tools: new Map(), first: t, last: t, ms: [] }));
  p.calls++;
  total++;
  if (typeof l.status === "number" && l.status >= 400) p.errors++;
  const day = new Date(t).toISOString().slice(0, 10);
  p.days.add(day);
  p.weeks.add(Math.floor((t / DAY + 3) / 7)); // Monday-based week number
  if (l.grant) p.grants.add(l.grant);
  if (l.tool) p.tools.set(l.tool, (p.tools.get(l.tool) ?? 0) + 1);
  p.first = Math.min(p.first, t);
  p.last = Math.max(p.last, t);
  if (typeof l.ms === "number") p.ms.push(l.ms);
}

if (people.size === 0) {
  console.log("No tools/call lines found in the given range.");
  process.exit(0);
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const rows = [...people.values()].map((p) => {
  const dayList = [...p.days].sort();
  const gaps = dayList.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dayList[i])) / DAY);
  const spanDays = Math.max(1, Math.round((p.last - p.first) / DAY) + 1);
  return {
    person: p.who,
    calls: p.calls,
    activeDays: p.days.size,
    activeWeeks: p.weeks.size,
    spanDays,
    activeShare: p.days.size / spanDays, // fraction of days in their tenure with use
    callsPerActiveDay: p.calls / p.days.size,
    medianGapDays: median(gaps),
    daysSinceLast: Math.floor((latest - p.last) / DAY),
    connections: p.grants.size,
    errorRate: p.errors / p.calls,
    first: new Date(p.first).toISOString().slice(0, 10),
    last: new Date(p.last).toISOString().slice(0, 10),
    topTools: [...p.tools].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t}×${n}`).join(", "),
  };
});

for (const r of rows) {
  const heavy = r.calls >= heavyMin;
  const frequent = r.activeDays >= 4 && (r.activeShare >= 0.4 || (r.medianGapDays ?? 99) <= 2);
  r.segment = heavy && frequent ? "power" : heavy ? "heavy (bursty)" : frequent ? "frequent (light)" : r.activeDays === 1 ? "one-off" : "occasional";
  if (r.segment !== "one-off" && r.daysSinceLast > 14) r.segment += ", lapsed";
}
rows.sort((a, b) => b.calls - a.calls);

const range = `${new Date(Math.max(since, Math.min(...rows.map((r) => Date.parse(r.first))))).toISOString().slice(0, 10)} → ${new Date(latest).toISOString().slice(0, 10)}`;
console.log(`\nMCP usage, ${range}: ${total} tool calls by ${rows.length} people\n`);

const top10 = rows.slice(0, Math.max(1, Math.ceil(rows.length / 10))).reduce((s, r) => s + r.calls, 0);
console.log(`Concentration: top 10% of people made ${((100 * top10) / total).toFixed(0)}% of calls; top person ${((100 * rows[0].calls) / total).toFixed(0)}%.`);
const seg = {};
for (const r of rows) seg[r.segment] = (seg[r.segment] ?? 0) + 1;
console.log("Segments: " + Object.entries(seg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") + "\n");

const fmt = (r) => [
  r.person.padEnd(14), String(r.calls).padStart(6), String(r.activeDays).padStart(5), String(r.activeWeeks).padStart(4),
  `${(100 * r.activeShare).toFixed(0)}%`.padStart(5), r.callsPerActiveDay.toFixed(1).padStart(6),
  (r.medianGapDays ?? "-").toString().padStart(4), String(r.daysSinceLast).padStart(5),
  `${(100 * r.errorRate).toFixed(0)}%`.padStart(5), r.segment.padEnd(24), r.topTools,
].join(" ");
console.log(["person".padEnd(14), " calls", " days", " wks", "share", " c/day", " gap", " idle", " err%", "segment".padEnd(24), "top tools"].join(" "));
for (const r of rows.slice(0, 40)) console.log(fmt(r));
if (rows.length > 40) console.log(`… ${rows.length - 40} more (use --csv for all)`);
console.log(`\nheavy = ≥ ${heavyMin} calls in the range (--heavy N); frequent = ≥ 4 active days and used on ≥ 40% of days since first use or a median gap ≤ 2 days; lapsed = idle > 14 days.`);

if (csvOut) {
  const cols = Object.keys(rows[0]);
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
  writeFileSync(csvOut, [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
  console.log(`Wrote ${rows.length} rows to ${csvOut}`);
}
