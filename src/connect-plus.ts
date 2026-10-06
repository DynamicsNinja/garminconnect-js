/**
 * The `Garmin` methods that need a Garmin Connect+ subscription. Without it Garmin answers their
 * endpoints with a bare 403; these methods turn that into `GarminConnectPlusRequiredError` after
 * confirming with `hasConnectPlus()` that the subscription is really missing. Verified on
 * 2026-10-06: the same calls 403'd on two accounts without Connect+ and succeeded on one with it.
 *
 * `getNutritionDailyFoodLog`, `getNutritionDailyMeals`, `getNutritionDailySettings` and
 * `getNutritionFoodLogRange` are NOT here: they answer without Connect+ (with nothing logged).
 *
 * The generated manifest marks these methods `requiresConnectPlus`, and a test keeps this list,
 * the manifest and AGENTS.md in step.
 */
export const CONNECT_PLUS_METHODS = [
  "searchFoods",
  "getCustomFoods",
  "getCustomFoodServingUnits",
  "createCustomFood",
  "updateCustomFood",
  "deleteCustomFood",
  "logFood",
  "quickAddFood",
  "deleteFoodLogs",
] as const;

export type ConnectPlusMethod = (typeof CONNECT_PLUS_METHODS)[number];
