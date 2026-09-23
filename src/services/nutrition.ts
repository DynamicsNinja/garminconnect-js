import { pathSegment } from "../util/validate.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  NutritionDailyFoodLog,
  NutritionDailyMeals,
  NutritionDailySettings,
} from "../types/nutrition.js";

/** Nutrition: daily food log, daily meals, daily nutrition settings. */
export interface NutritionHost {
  readonly client: GarminClient;
}

/**
 * Upstream `get_nutrition_daily_food_log`. `null_behaviour`: passes through unchecked.
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
 * Upstream `get_nutrition_daily_meals`. `null_behaviour`: passes through unchecked.
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
 * Upstream `get_nutrition_daily_settings`. `null_behaviour`: passes through unchecked.
 */
export async function getNutritionDailySettings(
  host: NutritionHost,
  cdate: string | Date,
): Promise<NutritionDailySettings | null> {
  return host.client.connectapi<NutritionDailySettings>(
    `/nutrition-service/settings/${pathSegment(formatDate(cdate))}`,
  );
}
