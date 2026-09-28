import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WORKOUT_EXERCISE_CATEGORIES, WORKOUT_SPEC_JSON_SCHEMA, workoutFromSpec, type WorkoutInput } from "garminconnect-js";
import { EXERCISES } from "garminconnect-js/exercises";
import { textResult } from "./results.js";
import type { ToolFactory } from "./server.js";
import { summarizeWorkout } from "./summary.js";

// The spec schema nests under `spec`; its $defs must sit at the TOOL root for "#/$defs/…" refs.
const { $schema: _schema, $defs, ...SPEC } = WORKOUT_SPEC_JSON_SCHEMA;

function specInput(extra: Record<string, object> = {}): Tool["inputSchema"] {
  return {
    type: "object",
    properties: { ...extra, spec: SPEC },
    required: [...Object.keys(extra), "spec"],
    additionalProperties: false,
    $defs,
  };
}

const build = (input: Record<string, unknown>): WorkoutInput => workoutFromSpec(input["spec"], EXERCISES);
const asJson = (w: WorkoutInput) => w as unknown as Record<string, unknown>;

const UNITS = "Paces are minutes as decimals (4:30 = 4.5), distances metres, times seconds.";

const CATEGORY_SET = new Set<string>(WORKOUT_EXERCISE_CATEGORIES);

/**
 * Resolves a caller-supplied category against `WORKOUT_EXERCISE_CATEGORIES`. Categories are
 * SCREAMING_SNAKE_CASE (`"SQUAT"`), and a model or a human is more likely to type `"squat"`, so a
 * case miss is corrected rather than rejected outright. Returns `null` only when even the
 * upper-cased form isn't a real category.
 */
export function resolveExerciseCategory(category: string): string | null {
  if (CATEGORY_SET.has(category)) return category;
  const upper = category.toUpperCase();
  return CATEGORY_SET.has(upper) ? upper : null;
}

export function searchExercises(query: string, category?: string, limit = 25): string[] {
  const words = query.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0 && !category) return [];
  const joined = words.join("_");
  const hits: { line: string; nameExact: number; catExact: number; score: number }[] = [];
  for (const [cat, names] of Object.entries(EXERCISES) as [string, readonly string[]][]) {
    if (category && cat !== category) continue;
    for (const name of names) {
      const parts = name.split("_").filter(Boolean);
      const matched = words.filter((w) => parts.some((p) => p.startsWith(w))).length;
      if (words.length > 0 && matched === 0) continue;
      hits.push({
        line: `${cat} / ${name}`,
        nameExact: name === joined ? 1 : 0,
        catExact: cat === joined ? 1 : 0,
        score: matched * 100 - parts.length,
      });
    }
  }
  return hits
    .sort((a, b) => b.nameExact - a.nameExact || b.catExact - a.catExact || b.score - a.score || a.line.localeCompare(b.line))
    .slice(0, limit)
    .map((h) => h.line);
}

export const workoutTools: ToolFactory = ({ session }) => [
  {
    tool: {
      name: "preview_workout",
      description:
        "Check a workout and show it in readable form WITHOUT saving anything. Always call this first, show the user " +
        `the result, and wait for them to confirm before create_workout. ${UNITS}`,
      inputSchema: specInput(),
      annotations: { title: "Preview workout", readOnlyHint: true, openWorldHint: false },
    },
    run: async (input) =>
      textResult(
        `${summarizeWorkout(build(input))}\n\nNothing has been saved. If the user confirms, call create_workout with the same spec.`,
      ),
  },
  {
    tool: {
      name: "create_workout",
      description:
        "Save a workout to the user's Garmin Connect workout library. Only after the user has confirmed a " +
        "preview_workout of the same spec. Look exercise names up with search_exercises first; an unknown name is " +
        "rejected. Afterwards, schedule_workout (if available) puts it on the calendar and push_workout_to_device " +
        `(if available) sends it to the watch. ${UNITS}`,
      inputSchema: specInput(),
      annotations: { title: "Create workout", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run: async (input) => {
      const workout = build(input);
      const created = await (await session.get()).uploadWorkout(asJson(workout));
      const id = (created as { workoutId?: unknown } | null)?.workoutId;
      const idLabel = typeof id === "string" || typeof id === "number" ? ` ${id}` : "";
      return textResult(`Created workout${idLabel}.\n\n${summarizeWorkout(workout)}`);
    },
  },
  {
    tool: {
      name: "update_workout",
      description:
        "Replace an existing workout with a new spec. This OVERWRITES the whole workout; confirm with the user first, " +
        `ideally after preview_workout. ${UNITS}`,
      inputSchema: specInput({ workoutId: { type: ["integer", "string"], description: "From get_workouts or create_workout" } }),
      annotations: { title: "Update workout", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run: async (input) => {
      const workout = build(input);
      const id = input["workoutId"] as number | string;
      await (await session.get()).updateWorkout(id, asJson(workout));
      return textResult(`Updated workout ${String(id)}.\n\n${summarizeWorkout(workout)}`);
    },
  },
  {
    tool: {
      name: "search_exercises",
      description:
        "Find Garmin exercise names for strength, HIIT, cardio, yoga, pilates and mobility steps. Returns " +
        "CATEGORY / NAME lines; use them as exercise: { category, name }.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Words to look for, e.g. "back squat" or "push up"' },
          category: { enum: [...WORKOUT_EXERCISE_CATEGORIES], description: "Only search this category" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { title: "Search exercises", readOnlyHint: true, openWorldHint: false },
    },
    run: async (input) => {
      const query = typeof input["query"] === "string" ? input["query"] : "";
      const rawCategory = input["category"];
      let category: string | undefined;
      if (typeof rawCategory === "string") {
        const resolved = resolveExerciseCategory(rawCategory);
        if (resolved === null) {
          return textResult(
            `Unknown category "${rawCategory}". Valid categories: ${WORKOUT_EXERCISE_CATEGORIES.join(", ")}`,
          );
        }
        category = resolved;
      }
      const hits = searchExercises(query, category);
      return textResult(
        hits.length > 0 ? hits.join("\n") : "No matching exercises. Try fewer or different words, or a category alone (e.g. SQUAT).",
      );
    },
  },
];
