/**
 * Drives the REAL server through an MCP client against the TEST account: preview, create, read
 * back, assert the STORED workout, delete. A 2xx proves nothing (that is how the walking/hiking
 * helpers once shipped "verified" while storing a null sport), so this checks the stored document.
 *
 *   npm run smoke:mcp
 */
import "../../scripts/load-env.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { fileSession, loadConfig } from "../src/session.js";
import { TOOL_FACTORIES } from "../src/tools.js";

const session = fileSession("./tokens");
const garmin = await session.get().catch(() => {
  console.error("No tokens in ./tokens. Run `npm run login` first.");
  process.exit(1);
});

// SAFETY GATE: identical to every other write script here. Not conditional, not skippable.
const expected = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expected) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await garmin.getUserProfile();
if (String(profile.profileId) !== String(expected)) {
  console.error(`Refusing to run: profile ${String(profile.profileId)} is not the test account. Nothing was written.`);
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

const server = createServer({ config: loadConfig({ GARMIN_MCP_TOKEN_DIR: "./tokens" }), session }, TOOL_FACTORIES);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(clientSide);

const text = (r: unknown) => (r as { content: { text?: string }[] }).content.map((c) => c.text ?? "").join("\n");
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} failed: ${text(r)}`);
  return text(r);
};

const SPEC = {
  name: `mcp smoke ${new Date().toISOString()}`,
  sport: "running",
  steps: [
    { type: "warmup", lapButton: true },
    { type: "repeat", times: 6, steps: [
      { type: "interval", distance: 400, target: { pace: { minPerKm: [4.2, 4] } } }, // deliberately reversed
      { type: "recovery", time: 120 },
    ] },
    { type: "cooldown", time: 600 },
  ],
};

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

type Doc = Record<string, unknown>;
let workoutId: string | undefined;
try {
  console.log(await call("preview_workout", { spec: SPEC }), "\n");
  const created = await call("create_workout", { spec: SPEC });
  workoutId = /Created workout (\d+)/.exec(created)?.[1];
  check("create_workout returned an id", workoutId !== undefined, created.split("\n")[0]);
  if (workoutId) {
    const stored = JSON.parse(await call("get_workout_by_id", { workoutId })) as Doc;
    const segment = (stored["workoutSegments"] as Doc[])[0]!;
    const steps = segment["workoutSteps"] as Doc[];
    const repeat = steps[1]!;
    const interval = (repeat["workoutSteps"] as Doc[])[0]!;
    const orders: number[] = [];
    const walk = (list: Doc[]) => list.forEach((s) => { orders.push(s["stepOrder"] as number); if (s["type"] === "RepeatGroupDTO") walk(s["workoutSteps"] as Doc[]); });
    walk(steps);
    check("stored sport is running", (stored["sportType"] as Doc)["sportTypeKey"] === "running");
    check("stepOrders are globally unique", new Set(orders).size === orders.length, orders.join(","));
    check("repeat stored 6 iterations", repeat["numberOfIterations"] === 6);
    const one = interval["targetValueOne"] as number;
    const two = interval["targetValueTwo"] as number;
    check("pace stored fastest first despite reversed input", one > two && Math.abs(one - 1000 / 240) < 0.01, `${one} / ${two}`);
  }
} finally {
  if (workoutId) {
    await call("delete_workout", { workoutId });
    const after = await client.callTool({ name: "get_workout_by_id", arguments: { workoutId } });
    check("delete_workout removed it", after.isError === true || text(after).startsWith("null"), text(after).slice(0, 80));
  }
  await client.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
