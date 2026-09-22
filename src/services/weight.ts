import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type { WeighInRange } from "../types/weight.js";

export interface WeightHost {
  readonly client: GarminClient;
}

const GRAMS_PER_LB = 453.592;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Local wall-clock time formatted as Garmin's `dateTimestamp` expects
 * (`YYYY-MM-DDTHH:mm:ss.00`, no offset). Deliberately built from the local
 * getters (`getFullYear`/`getHours`/...), not `toISOString()`, which is
 * always UTC.
 */
function formatLocalTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.00`
  );
}

/** UTC instant formatted as Garmin's `gmtTimestamp` expects. */
function formatGmtTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19) + ".00";
}

export async function getWeighIns(
  host: WeightHost,
  startdate: string | Date,
  enddate: string | Date,
): Promise<WeighInRange> {
  const start = formatDate(startdate);
  const end = formatDate(enddate);
  const data = await host.client.connectapi<WeighInRange>(
    `/weight-service/weight/range/${start}/${end}`,
    { params: { includeAll: "true" } },
  );
  return data ?? {};
}

export async function addWeighIn(
  host: WeightHost,
  weight: number,
  unitKey: "kg" | "lbs" = "kg",
  when: Date = new Date(),
): Promise<unknown> {
  // Garmin stores weight in grams regardless of the unit the caller used.
  const grams =
    unitKey === "kg" ? Math.round(weight * 1000) : Math.round(weight * GRAMS_PER_LB);
  // `when` is captured once by the caller (defaulting to `new Date()` at the
  // call site) so both fields describe the same instant — computing it twice
  // here could straddle a millisecond and disagree by a second.
  return host.client.connectapi("/weight-service/user-weight", {
    method: "POST",
    json: {
      dateTimestamp: formatLocalTimestamp(when),
      gmtTimestamp: formatGmtTimestamp(when),
      unitKey,
      sourceType: "MANUAL",
      value: grams,
    },
  });
}

export async function deleteWeighIn(
  host: WeightHost,
  cdate: string | Date,
  weightPk: number,
): Promise<null> {
  await host.client.connectapi(
    `/weight-service/weight/${formatDate(cdate)}/byversion/${weightPk}`,
    { method: "DELETE" },
  );
  return null;
}
