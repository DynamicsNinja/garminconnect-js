import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import { FitEncoderWeight, type WeightScaleFields } from "../util/fit.js";
import type { BodyCompositionRange } from "../types/bodyComposition.js";

export interface BodyCompositionHost {
  readonly client: GarminClient;
}

export async function getBodyComposition(
  host: BodyCompositionHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<BodyCompositionRange | null> {
  const start = formatDate(startdate);
  const end = enddate === undefined ? start : formatDate(enddate);
  if (start > end) {
    throw new GarminError("getBodyComposition: start date must not be after end date");
  }
  return host.client.connectapi<BodyCompositionRange>("/weight-service/weight/dateRange", {
    params: { startDate: start, endDate: end },
  });
}

/**
 * UNCERTAIN (inventory): upstream `add_body_composition` has no null check
 * on the multipart-upload response and returns `self.client.post(...)`
 * directly; this mirrors that by returning whatever `client.upload` gives
 * back unchecked (`null` on a 204/empty body, per this library's `upload`
 * contract).
 *
 * `weight` (and every optional metric) is assumed to already be in the
 * units upstream's `gc.py` assumes (kilograms for `weight`, percentages for
 * the `percent*` fields, etc.) — `gc.py` itself performs no unit conversion
 * before handing values to `FitEncoderWeight`. See `src/util/fit.ts` for the
 * scaling `write_weight_scale` DOES apply (a FIT binary-format requirement,
 * confirmed by reading upstream's `fit.py` directly — not left as a guess).
 * LIVE-VERIFIED end to end on 2026-09-23 (this note previously said it was
 * not): 69.42 kg was uploaded as a `.fit` binary and read back from
 * `getBodyComposition` as 69.42 kg. Garmin both ACCEPTED the bytes — so the
 * CRC and header are right — and PARSED them correctly, so the x100 scaling
 * is right. A wrong CRC would have been rejected outright; a wrong scale
 * factor would have been accepted and silently misparsed, which only the
 * read-back could tell apart.
 *
 * `timestamp`, if given, is parsed with `new Date(timestamp)`; if omitted,
 * `new Date()` is used, matching upstream's `datetime.fromisoformat(timestamp)
 * if timestamp else datetime.now()`.
 */
export async function addBodyComposition(
  host: BodyCompositionHost,
  weight: number,
  extra: WeightScaleFields & { timestamp?: string } = {},
): Promise<unknown> {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new GarminError("weight must be a positive, finite number");
  }
  const { timestamp, ...fields } = extra;
  const when = timestamp !== undefined ? new Date(timestamp) : new Date();
  if (Number.isNaN(when.getTime())) {
    throw new GarminError(`invalid timestamp: "${String(timestamp)}"`);
  }

  const encoder = new FitEncoderWeight();
  // No argument, matching upstream's bare `fitEncoder.write_file_info()`.
  // `file_id.time_created` is file METADATA — when the .fit was produced —
  // and stays at the real current instant even when `when` is backdated.
  // Only the health data below carries the caller's timestamp.
  encoder.writeFileInfo();
  encoder.writeFileCreator();
  encoder.writeDeviceInfo(when);
  encoder.writeWeightScale(when, weight, fields);
  const fitBytes = encoder.finish();

  const file = new Blob([fitBytes], { type: "application/octet-stream" });
  return host.client.upload(file, "body_composition.fit", "/upload-service/upload");
}
