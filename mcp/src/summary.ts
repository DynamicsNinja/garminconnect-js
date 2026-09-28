/**
 * A workout as a person reads it. Presentation only: it reads the built `WorkoutInput`, so what
 * the user confirms in a preview is exactly what would be uploaded.
 */
import type { WorkoutInput } from "garminconnect-js";

type Doc = Record<string, unknown>;

const key = (ref: unknown, field: string): string | undefined => {
  const v = (ref as Doc | null | undefined)?.[field];
  return typeof v === "string" ? v : undefined;
};
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const words = (k: string) => k.toLowerCase().replace(/[._]+/g, " ");
const trim = (n: number) => String(+n.toFixed(1));

export function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

const metres = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(2)} km` : `${trim(m)} m`);
const pace = (metresPerSecond: number) => clock(1000 / metresPerSecond);

const STEP_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  cooldown: "Cool-down",
  interval: "Interval",
  recovery: "Recovery",
  rest: "Rest",
  main: "Main",
  other: "Other",
};

function end(step: Doc): string {
  const kind = key(step["endCondition"], "conditionTypeKey");
  const v = num(step["endConditionValue"]) ?? 0;
  switch (kind) {
    case "time":
      return clock(v);
    case "distance":
      return metres(v);
    case "lap.button":
      return "until lap button";
    case "reps":
      return `${v} reps`;
    case "fixed.rest":
      return `${clock(v)} rest`;
    case "calories":
      return `${v} kcal`;
    case "heart.rate":
      return `until heart rate ${v} bpm`;
    case "power":
      return `until ${v} W`;
    case "fixed.repetition":
      return `${v} lengths`;
    default:
      return kind ?? "no end condition";
  }
}

function target(step: Doc, secondary: boolean): string | undefined {
  const f = (primary: string, second: string) => step[secondary ? second : primary];
  const type = key(f("targetType", "secondaryTargetType"), "workoutTargetTypeKey");
  const one = num(f("targetValueOne", "secondaryTargetValueOne"));
  const two = num(f("targetValueTwo", "secondaryTargetValueTwo"));
  const zone = num(f("zoneNumber", "secondaryZoneNumber"));
  const range = (unit: string) => (one !== undefined && two !== undefined ? `${trim(one)}–${trim(two)} ${unit}` : undefined);
  switch (type) {
    case undefined:
    case "no.target":
      return undefined;
    case "pace.zone":
      return one !== undefined && two !== undefined ? `${pace(one)}–${pace(two)} /km` : undefined;
    case "speed.zone":
      return range("m/s");
    case "heart.rate.zone":
      return zone !== undefined ? `heart-rate zone ${zone}` : range("bpm");
    case "power.zone":
      return zone !== undefined ? `power zone ${zone}` : range("W");
    case "cadence":
      return range("rpm");
    case "grade":
      return range("% grade");
    case "resistance":
      return range("resistance");
    case "swim.css.offset":
      return one !== undefined ? `CSS ${one >= 0 ? "+" : ""}${one} s` : undefined;
    default:
      return words(type);
  }
}

function stepLine(step: Doc): string {
  const parts = [`${STEP_LABEL[key(step["stepType"], "stepTypeKey") ?? ""] ?? "Step"}: ${end(step)}`];
  const primary = target(step, false);
  const second = target(step, true);
  if (primary) parts.push(`@ ${primary}`);
  if (second) parts.push(`+ ${second}`);
  const exercise = key(step, "exerciseName") ?? key(step, "category");
  if (exercise) parts.push(words(exercise));
  const weight = num(step["weightValue"]);
  if (weight !== undefined) parts.push(`${trim(weight)} kg`);
  for (const [field, k] of [["strokeType", "strokeTypeKey"], ["drillType", "drillTypeKey"], ["equipmentType", "equipmentTypeKey"]] as const) {
    const v = key(step[field], k);
    if (v) parts.push(words(v));
  }
  const note = key(step, "description");
  if (note) parts.push(`"${note}"`);
  return parts.join(" · ");
}

function lines(steps: Doc[], indent: string, out: string[]): void {
  steps.forEach((step, i) => {
    const n = `${indent}${i + 1}. `;
    if (step["type"] === "RepeatGroupDTO") {
      const times = num(step["numberOfIterations"]);
      out.push(`${n}${times !== undefined ? `Repeat ${times}×` : `Repeat for ${clock(num(step["endConditionValue"]) ?? 0)}`}:`);
      lines(step["workoutSteps"] as Doc[], `${indent}   `, out);
    } else {
      out.push(`${n}${stepLine(step)}`);
    }
  });
}

export function summarizeWorkout(workout: WorkoutInput): string {
  const doc = workout as unknown as Doc;
  const sport = key(doc["sportType"], "sportTypeKey") ?? "unknown sport";
  const pool = num(doc["poolLength"]);
  const poolUnit = key(doc["poolLengthUnit"], "unitKey") === "yard" ? "yd" : "m";
  const out = [`${workout.workoutName} — ${words(sport)}${pool !== undefined ? `, ${pool} ${poolUnit} pool` : ""}`];
  const segments = doc["workoutSegments"] as Doc[];
  if (segments.length === 1) {
    lines(segments[0]!["workoutSteps"] as Doc[], "", out);
  } else {
    segments.forEach((segment, i) => {
      out.push(`Leg ${i + 1}: ${words(key(segment["sportType"], "sportTypeKey") ?? "?")}`);
      lines(segment["workoutSteps"] as Doc[], "   ", out);
    });
  }
  return out.join("\n");
}
