import { pathSegment, validateNonNegativeInteger, validatePositiveInteger } from "../util/validate.js";
import { GarminAuthError, GarminConnectPlusRequiredError, GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import type { ConnectPlusMethod } from "../connect-plus.js";
import { hasConnectPlus, type ConnectPlusHost } from "./userProfile.js";
import { formatDate } from "../util/date.js";
import type {
  CustomFoodInput,
  CustomFoodList,
  Food,
  FoodLogInput,
  FoodSearchResult,
  MealName,
  NutritionFoodLogRange,
  QuickAddInput,
  NutritionDailyFoodLog,
  NutritionDailyMeals,
  NutritionDailySettings,
} from "../types/nutrition.js";

/**
 * Nutrition: daily food log, daily meals, daily nutrition settings, food logging. `getUserProfile`
 * is only used to tell a missing Connect+ subscription apart from other 403s.
 */
export interface NutritionHost extends ConnectPlusHost {
  readonly client: GarminClient;
}

/**
 * Runs a Connect+ call. A 403 from it is re-raised as `GarminConnectPlusRequiredError` when the
 * profile confirms the subscription is missing; any other error, or a 403 on an account that DOES
 * have Connect+, is re-raised unchanged.
 */
async function connectPlusCall<T>(host: NutritionHost, method: ConnectPlusMethod, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GarminAuthError && /\(403\)$/.test(error.message)) {
      const subscribed = await hasConnectPlus(host).catch(() => true);
      if (!subscribed) throw new GarminConnectPlusRequiredError(method, { cause: error });
    }
    throw error;
  }
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getNutritionDailyFoodLog(
  host: NutritionHost,
  cdate: string | Date,
): Promise<NutritionDailyFoodLog | null> {
  return host.client.connectapi<NutritionDailyFoodLog>(
    `/nutrition-service/food/logs/${pathSegment(formatDate(cdate))}`,
  );
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getNutritionDailyMeals(
  host: NutritionHost,
  cdate: string | Date,
): Promise<NutritionDailyMeals | null> {
  return host.client.connectapi<NutritionDailyMeals>(
    `/nutrition-service/meals/${pathSegment(formatDate(cdate))}`,
  );
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getNutritionDailySettings(
  host: NutritionHost,
  cdate: string | Date,
): Promise<NutritionDailySettings | null> {
  return host.client.connectapi<NutritionDailySettings>(
    `/nutrition-service/settings/${pathSegment(formatDate(cdate))}`,
  );
}

// ---------------------------------------------------------------------------
// Food logging. Each method verified live on 2026-10-06 against a real account with Garmin Connect+, by write -> read back -> delete
// (scripts/smoke-nutrition-real.ts). EVERY method below except getNutritionFoodLogRange answers
// 403 on an account without Connect+, and Connect+ needs a paired Garmin device.
//
// Two traps: creating AND updating a custom food are both `PUT /nutrition-service/customFood`
// (there is no POST), and a food log entry needs a `mealId`, which only exists once the account
// has been through Garmin's nutrition setup (otherwise a 400 "mealId must not be null").
// ---------------------------------------------------------------------------

const MEAL_NAMES: ReadonlySet<string> = new Set<MealName>(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]);

/** `"HH:MM"` or `"HH:MM:SS"` -> `"HH:MM:SS"`; throws on anything else. */
function clockTime(value: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!m) throw new GarminError(`time must be "HH:MM" or "HH:MM:SS" (24-hour); got "${value}"`);
  return `${m[1]!}:${m[2]!}:${m[3] ?? "00"}`;
}

/** Garmin's own timestamp format for a log entry: UTC, milliseconds always `.000`. */
function logTimestamp(): string {
  return `${new Date().toISOString().slice(0, 19)}.000Z`;
}

/** Number -> the string form Garmin's food bodies use ("160", not "160.0"). */
function num(value: number, name: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new GarminError(`${name} must be a non-negative number; got ${String(value)}`);
  }
  return String(value);
}

interface MealDay {
  meals?: { mealId: number; mealName: string; startTime?: string; endTime?: string }[];
}

/**
 * Resolves the meal an entry goes into, and the time it is logged at.
 *
 * With a `time`: the named meal, else the meal whose window contains it, else SNACKS — the rule
 * Garmin's own quick-add uses. Garmin VALIDATES the pairing: a snack at a time
 * inside LUNCH's window is a 400 "Meal time for Snacks overlap with meal type: LUNCH" (verified).
 * With a `meal` and no `time`, a time that fits is chosen: the meal's own start, or for a meal
 * whose window holds another meal's (SNACKS), the first minute that is in no other meal's window at all.
 */
async function resolveMeal(
  host: NutritionHost,
  method: ConnectPlusMethod,
  date: string,
  time: string | undefined,
  meal?: MealName,
): Promise<{ mealId: number; time: string }> {
  if (meal !== undefined && !MEAL_NAMES.has(meal)) {
    throw new GarminError(`meal must be BREAKFAST, LUNCH, DINNER or SNACKS; got "${String(meal)}"`);
  }
  const day = await host.client.connectapi<MealDay>(`/nutrition-service/meals/${pathSegment(date)}`);
  const meals = day?.meals ?? [];
  if (meals.length === 0) {
    // Without Connect+ the meals read still succeeds, just empty — say what is actually missing.
    if (!(await hasConnectPlus(host).catch(() => true))) throw new GarminConnectPlusRequiredError(method);
    throw new GarminError(
      `No meals are set up for ${date}. Garmin creates them during the nutrition setup in the ` +
        "Garmin Connect app; until then every food log is rejected.",
    );
  }
  const pad = (t: string) => (t.length === 5 ? `${t}:00` : t);
  const within = (m: MealDay["meals"] extends (infer M)[] | undefined ? M : never, t: string) =>
    Boolean(m.startTime && m.endTime && pad(m.startTime) <= t && t <= pad(m.endTime));

  if (time !== undefined) {
    const chosen =
      meal !== undefined
        ? meals.find((m) => m.mealName === meal)
        : (meals.find((m) => m.mealName !== "SNACKS" && within(m, time)) ?? meals.find((m) => m.mealName === "SNACKS"));
    if (!chosen) throw new GarminError(`No ${meal ?? "matching"} meal on ${date}`);
    return { mealId: chosen.mealId, time };
  }

  const chosen = meals.find((m) => m.mealName === (meal ?? "LUNCH")) ?? meals[0]!;
  const others = meals.filter((m) => m !== chosen);
  // The overlap rule Garmin enforces is SNACKS-vs-the-rest; another meal only has to be in its
  // own window (SNACKS' all-day window contains everything).
  const fits = (t: string) =>
    !others.some((m) => (chosen.mealName === "SNACKS" || m.mealName !== "SNACKS") && within(m, t));
  const ownStart = chosen.startTime ? [pad(chosen.startTime)] : [];
  const gaps = others.filter((m) => m.endTime).map((m) => addMinute(pad(m.endTime!))).sort();
  // SNACKS spans the day, so its own start is midnight; a gap after a meal reads better.
  const candidates = chosen.mealName === "SNACKS" ? [...gaps, ...ownStart] : [...ownStart, ...gaps];
  const picked = candidates.find((t) => (chosen.startTime && chosen.endTime ? within(chosen, t) : true) && fits(t));
  if (!picked) throw new GarminError(`Could not find a time for ${chosen.mealName} on ${date}; pass time explicitly`);
  return { mealId: chosen.mealId, time: picked };
}

function addMinute(t: string): string {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const total = Math.min(h * 60 + m + 1, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

/** Catalogue search (`GET /nutrition-service/food/search`). Needs Connect+. */
export async function searchFoods(
  host: NutritionHost,
  query: string,
  start = 0,
  limit = 20,
): Promise<FoodSearchResult | null> {
  if (!query.trim()) throw new GarminError("searchFoods needs a non-empty query");
  validateNonNegativeInteger(start, "start");
  validatePositiveInteger(limit, "limit");
  return connectPlusCall(host, "searchFoods", () =>
    host.client.connectapi<FoodSearchResult>("/nutrition-service/food/search", {
      params: { searchExpression: query, start, limit },
    }),
  );
}

/**
 * Daily food logs over a range (`GET /nutrition-service/food/logs/range`), one entry per day that
 * has anything logged. Works WITHOUT Connect+ (returns no days then).
 */
export async function getNutritionFoodLogRange(
  host: NutritionHost,
  startdate: string | Date,
  enddate: string | Date,
): Promise<NutritionFoodLogRange | null> {
  const startDate = formatDate(startdate);
  const endDate = formatDate(enddate);
  if (startDate > endDate) throw new GarminError("getNutritionFoodLogRange: start date must not be after end date");
  return host.client.connectapi<NutritionFoodLogRange>("/nutrition-service/food/logs/range", {
    params: { startDate, endDate },
  });
}

/**
 * Your custom foods (`GET /nutrition-service/customFood`), optionally filtered by name. Garmin
 * caps `limit` at 20 (a 400 otherwise), so this method does too. There is no GET by id — a
 * `GET /customFood/{id}` is a 405 — so search by name to read one back.
 */
export async function getCustomFoods(
  host: NutritionHost,
  search = "",
  start = 0,
  limit = 20,
): Promise<CustomFoodList | null> {
  validateNonNegativeInteger(start, "start");
  validatePositiveInteger(limit, "limit");
  if (limit > 20) throw new GarminError("limit must be at most 20; Garmin rejects more");
  return connectPlusCall(host, "getCustomFoods", () =>
    host.client.connectapi<CustomFoodList>("/nutrition-service/customFood", {
      params: { searchExpression: search, start, limit, includeContent: "true" },
    }),
  );
}

/** Serving units a custom food can use (`{ servingUnits: [{ name }] }`; 13 on 2026-10-06). */
export async function getCustomFoodServingUnits(
  host: NutritionHost,
): Promise<{ servingUnits: { name: string }[] } | null> {
  return connectPlusCall(host, "getCustomFoodServingUnits", () =>
    host.client.connectapi<{ servingUnits: { name: string }[] }>(
      "/nutrition-service/metadata/customFoodServingUnits",
    ),
  );
}

function customFoodBody(input: CustomFoodInput, ids?: { foodId: string; servingId: string }) {
  if (!input.name.trim()) throw new GarminError("A custom food needs a non-empty name");
  const serving: Record<string, string> = {
    ...(ids && { servingId: ids.servingId }),
    servingUnit: input.servingUnit ?? "G",
    numberOfUnits: num(input.servingSize ?? 100, "servingSize"),
    calories: num(input.calories, "calories"),
  };
  const optional: [keyof CustomFoodInput, string][] = [
    ["carbs", "carbs"],
    ["protein", "protein"],
    ["fat", "fat"],
    ["fiber", "fiber"],
    ["sugar", "sugar"],
    ["saturatedFat", "saturatedFat"],
    ["transFat", "transFat"],
    ["sodium", "sodium"],
    ["cholesterol", "cholesterol"],
    ["potassium", "potassium"],
    ["calcium", "calcium"],
    ["iron", "iron"],
    ["vitaminD", "vitaminD"],
  ];
  for (const [key, field] of optional) {
    const value = input[key];
    if (typeof value === "number") serving[field] = num(value, key);
  }
  return {
    foodMetaData: {
      ...(ids && { foodId: ids.foodId }),
      foodName: input.name,
      foodType: "GENERIC",
      source: "GARMIN",
      regionCode: "US",
      languageCode: "en",
      ...(input.brand !== undefined && { brandName: input.brand }),
    },
    nutritionContents: [serving],
  };
}

/**
 * Creates a custom food and returns it as stored, with the `foodId` and `servingId` that
 * `logFood` takes. It is a PUT to `/nutrition-service/customFood` — Garmin has no POST for it.
 */
export async function createCustomFood(host: NutritionHost, input: CustomFoodInput): Promise<Food | null> {
  const json = customFoodBody(input);
  return connectPlusCall(host, "createCustomFood", () =>
    host.client.connectapi<Food>("/nutrition-service/customFood", { method: "PUT", json }),
  );
}

/**
 * Replaces a custom food's definition — the same PUT as `createCustomFood`, carrying the ids.
 * FULL REPLACE: a nutrient left out of `input` is removed, not kept.
 */
export async function updateCustomFood(
  host: NutritionHost,
  foodId: string,
  servingId: string,
  input: CustomFoodInput,
): Promise<Food | null> {
  if (!foodId || !servingId) throw new GarminError("updateCustomFood needs both foodId and servingId");
  const json = customFoodBody(input, { foodId, servingId });
  return connectPlusCall(host, "updateCustomFood", () =>
    host.client.connectapi<Food>("/nutrition-service/customFood", { method: "PUT", json }),
  );
}

/** `DELETE /nutrition-service/customFood/{foodId}`. IRREVERSIBLE. */
export async function deleteCustomFood(host: NutritionHost, foodId: string): Promise<unknown> {
  return connectPlusCall(host, "deleteCustomFood", () =>
    host.client.connectapi(`/nutrition-service/customFood/${pathSegment(foodId)}`, { method: "DELETE" }),
  );
}

/**
 * Logs a catalogue or custom food (`PUT /nutrition-service/food/logs`) and returns the whole day's
 * log as Garmin stores it. Pass `source` from the food's `foodMetaData` for a catalogue food;
 * the default `"GARMIN"` is right for a custom food. Fractional servings work (1.5 read back).
 */
export async function logFood(host: NutritionHost, input: FoodLogInput): Promise<NutritionDailyFoodLog | null> {
  const date = formatDate(input.date);
  const servings = input.servings ?? 1;
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new GarminError(`servings must be a positive number; got ${String(servings)}`);
  }
  if (!input.foodId || !input.servingId) throw new GarminError("logFood needs both foodId and servingId");
  const { mealId, time } = await resolveMeal(
    host,
    "logFood",
    date,
    input.time === undefined ? undefined : clockTime(input.time),
    input.meal,
  );
  return connectPlusCall(host, "logFood", () => host.client.connectapi<NutritionDailyFoodLog>("/nutrition-service/food/logs", {
    method: "PUT",
    json: {
      mealDate: date,
      foodLogItems: [
        {
          logTimestamp: logTimestamp(),
          logSource: "GCW",
          logCategory: "REGULAR_LOG",
          mealTime: time,
          action: "ADD",
          mealId,
          foodId: input.foodId,
          servingId: input.servingId,
          source: input.source ?? "GARMIN",
          regionCode: input.regionCode ?? "US",
          languageCode: input.languageCode ?? "en",
          servingQty: servings,
        },
      ],
    },
  }));
}

/**
 * Logs an entry by name and macros with no food behind it — Garmin's "Quick Add"
 * (`PUT /nutrition-service/food/logs/quickAdd`). Returns the whole day's log.
 */
export async function quickAddFood(host: NutritionHost, input: QuickAddInput): Promise<NutritionDailyFoodLog | null> {
  if (!input.name.trim()) throw new GarminError("quickAddFood needs a non-empty name");
  const date = formatDate(input.date);
  const body = {
    calories: num(input.calories, "calories"),
    carbs: num(input.carbs, "carbs"),
    protein: num(input.protein, "protein"),
    fat: num(input.fat, "fat"),
  };
  const { mealId, time } = await resolveMeal(
    host,
    "quickAddFood",
    date,
    input.time === undefined ? undefined : clockTime(input.time),
    input.meal,
  );
  return connectPlusCall(host, "quickAddFood", () => host.client.connectapi<NutritionDailyFoodLog>("/nutrition-service/food/logs/quickAdd", {
    method: "PUT",
    json: {
      mealDate: date,
      quickAddItems: [
        {
          name: input.name,
          logId: null,
          logTimestamp: logTimestamp(),
          logSource: "GCW",
          logCategory: "QUICK_ADD",
          mealTime: time,
          mealId,
          action: "ADD",
          ...body,
        },
      ],
    },
  }));
}

/**
 * Deletes log entries from one day (`DELETE /nutrition-service/food/logs/{date}` with
 * `{ logIds }` as the body) — any number in one call, regular and quick-add alike. A `logId` is on
 * each entry of `getNutritionDailyFoodLog`. IRREVERSIBLE.
 */
export async function deleteFoodLogs(host: NutritionHost, date: string | Date, logIds: string[]): Promise<unknown> {
  if (!Array.isArray(logIds) || logIds.length === 0 || logIds.some((id) => typeof id !== "string" || !id)) {
    throw new GarminError("deleteFoodLogs needs at least one logId");
  }
  const path = `/nutrition-service/food/logs/${pathSegment(formatDate(date))}`;
  return connectPlusCall(host, "deleteFoodLogs", () =>
    host.client.connectapi(path, { method: "DELETE", json: { logIds } }),
  );
}
