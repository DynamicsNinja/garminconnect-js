/**
 * Food-logging writes against a REAL account, because the test account cannot run them.
 *
 *   npx tsx scripts/smoke-nutrition-real.ts --yes-write-to-real-account
 *
 * Why a real account: every food-logging endpoint answers 403 without Garmin Connect+, and
 * Connect+ needs a paired Garmin device, which the test account will never have. Logging also
 * needs the meals Garmin creates during the app's nutrition setup.
 *
 * Gated like `push-workout-real.ts`: without the flag it only describes what it would do; it
 * refuses the test account; there is no npm alias.
 *
 * What it leaves behind: NOTHING. It creates a clearly-named custom food, logs it, quick-adds an
 * entry and logs one catalogue food, all on today's date, reads each back, and then deletes every
 * log entry that did not exist before it started (so the account's own entries are never
 * touched), and the custom food.
 *
 * Output is shapes and booleans — never the account's own values.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";

const CONFIRM = "--yes-write-to-real-account";
const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens-real") });
if (!(await client.loadTokens())) {
  console.error("No tokens in ./tokens-real. Run `npm run login:real` first.");
  process.exit(1);
}
const g = new Garmin(client);
const profile = await g.getUserProfile();
if (String(profile.profileId) === String(process.env["GARMIN_TEST_PROFILE_ID"])) {
  console.error("Refusing to run: ./tokens-real holds the TEST account, which has no Connect+.");
  process.exit(1);
}
const expectedReal = process.env["GARMIN_REAL_PROFILE_ID"];
if (expectedReal && String(profile.profileId) !== expectedReal) {
  console.error("Refusing to run: live profile does not match GARMIN_REAL_PROFILE_ID.");
  process.exit(1);
}
if (!process.argv.includes(CONFIRM)) {
  console.log(
    "DRY RUN — nothing was written.\n\nThis would, on today's date, create a custom food, log it, " +
      "quick-add one entry and log one catalogue food, read each back, then delete all of them.\n" +
      `Re-run with ${CONFIRM} to do it.`,
  );
  process.exit(0);
}

type Doc = Record<string, unknown>;
const DAY = new Date().toISOString().slice(0, 10);
const NAME = "gcjs probe food (safe to delete)";
let pass = 0;
let fail = 0;
const report = (ok: boolean, label: string, detail: string) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(36)} ${detail}`);
};
const describe = (e: unknown) =>
  e instanceof GarminHttpError ? `HTTP ${String(e.status)} ${e.body.slice(0, 160)}` : String(e);

/** Every log entry (an object carrying a string logId) in a day's log, by id. */
function entries(v: unknown, out = new Map<string, Doc>()): Map<string, Doc> {
  if (Array.isArray(v)) v.forEach((x) => entries(x, out));
  else if (v && typeof v === "object") {
    const o = v as Doc;
    if (typeof o["logId"] === "string") out.set(o["logId"], o);
    Object.values(o).forEach((x) => entries(x, out));
  }
  return out;
}

const before = entries(await g.getNutritionDailyFoodLog(DAY));
let foodId: string | undefined;
try {
  const units = await g.getCustomFoodServingUnits();
  report((units?.servingUnits ?? []).length > 0, "getCustomFoodServingUnits", `${String(units?.servingUnits.length)} units`);
  const search = await g.searchFoods("banana", 0, 3);
  const cat = search?.results[0];
  report(cat !== undefined && cat.nutritionContents.length > 0, "searchFoods", `${String(search?.results.length)} result(s), source ${String(cat?.foodMetaData.source)}`);

  const created = await g.createCustomFood({ name: NAME, calories: 250, carbs: 30, protein: 10, fat: 8, brand: "gcjs" });
  foodId = created?.foodMetaData.foodId;
  const servingId = created?.nutritionContents[0]?.servingId;
  const listed = (await g.getCustomFoods("gcjs probe"))?.customFoods.find((f) => f.foodMetaData.foodId === foodId);
  report(listed?.nutritionContents[0]?.calories === 250, "createCustomFood -> getCustomFoods", `stored ${String(listed?.nutritionContents[0]?.calories)} kcal`);

  await g.updateCustomFood(foodId!, servingId!, { name: NAME, calories: 260, carbs: 30, protein: 12, fat: 8 });
  const updated = (await g.getCustomFoods("gcjs probe"))?.customFoods.find((f) => f.foodMetaData.foodId === foodId);
  report(
    updated?.nutritionContents[0]?.calories === 260 && updated.nutritionContents[0]?.protein === 12 && updated.foodMetaData.brandName === undefined,
    "updateCustomFood (full replace)",
    `${String(updated?.nutritionContents[0]?.calories)} kcal, brand dropped: ${String(updated?.foodMetaData.brandName === undefined)}`,
  );

  await g.logFood({ date: DAY, time: "12:30", foodId: foodId!, servingId: servingId!, servings: 1.5 });
  await g.quickAddFood({ date: DAY, meal: "SNACKS", name: "gcjs probe quick add", calories: 123, carbs: 10, protein: 5, fat: 3 });
  if (cat) {
    await g.logFood({
      date: DAY,
      meal: "BREAKFAST",
      foodId: cat.foodMetaData.foodId,
      servingId: cat.nutritionContents[0]!.servingId,
      source: cat.foodMetaData.source,
      regionCode: cat.foodMetaData.regionCode,
      languageCode: cat.foodMetaData.languageCode,
    });
  }
  const added = [...entries(await g.getNutritionDailyFoodLog(DAY)).values()].filter((e) => !before.has(String(e["logId"])));
  const categories = added.map((e) => String(e["logCategory"])).sort().join(", ");
  report(added.length === (cat ? 3 : 2), "logFood + quickAddFood -> daily log", `${String(added.length)} new entr(ies): ${categories}`);
  // Each entry must sit in the meal it was aimed at: 12:30 -> LUNCH, named SNACKS, named BREAKFAST.
  const mealDay = (await g.getNutritionDailyMeals(DAY)) as { meals?: { mealId: number; mealName: string }[] } | null;
  const mealOf = (e: Doc) => mealDay?.meals?.find((m) => m.mealId === e["mealId"])?.mealName;
  const placed = added.map((e) => `${String(e["logCategory"])}->${String(mealOf(e))}`).sort();
  const expected = ["QUICK_ADD->SNACKS", "REGULAR_LOG->LUNCH", ...(cat ? ["REGULAR_LOG->BREAKFAST"] : [])].sort();
  report(JSON.stringify(placed) === JSON.stringify(expected), "entries landed in the intended meals", placed.join(", "));
  const range = await g.getNutritionFoodLogRange(DAY, DAY);
  report((range?.dailyNutritionSummaries ?? []).length === 1, "getNutritionFoodLogRange", `${String(range?.dailyNutritionSummaries.length)} day(s)`);
} catch (e) {
  report(false, "food logging round-trip", describe(e));
} finally {
  const now = entries(await g.getNutritionDailyFoodLog(DAY));
  const mine = [...now.keys()].filter((id) => !before.has(id));
  if (mine.length > 0) await g.deleteFoodLogs(DAY, mine);
  const after = entries(await g.getNutritionDailyFoodLog(DAY));
  report(
    [...after.keys()].every((id) => before.has(id)) && [...before.keys()].every((id) => after.has(id)),
    "deleteFoodLogs (batch)",
    `${String(mine.length)} probe entr(ies) deleted; the account's own ${String(before.size)} untouched`,
  );
  if (foodId) {
    await g.deleteCustomFood(foodId);
    const left = (await g.getCustomFoods("gcjs probe"))?.customFoods.filter((f) => f.foodMetaData.foodId === foodId) ?? [];
    report(left.length === 0, "deleteCustomFood", left.length === 0 ? "gone" : "still listed");
  }
}
console.log(`\n${String(pass)} passed, ${String(fail)} failed.`);
