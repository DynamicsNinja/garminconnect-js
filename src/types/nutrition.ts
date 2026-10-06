/**
 * `GET /nutrition-service/food/logs/{cdate}` (`get_nutrition_daily_food_log`). Passes through
 * unchecked; undocumented shape.
 */
export interface NutritionDailyFoodLog {
  [key: string]: unknown;
}

/**
 * `GET /nutrition-service/meals/{cdate}` (`get_nutrition_daily_meals`). Passes through unchecked;
 * undocumented shape.
 */
export interface NutritionDailyMeals {
  [key: string]: unknown;
}

/**
 * `GET /nutrition-service/settings/{cdate}` (`get_nutrition_daily_settings`). Passes through
 * unchecked; undocumented shape.
 */
export interface NutritionDailySettings {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Food logging — NOT upstream parity. Shapes read live on 2026-10-06 from a real account with
// Garmin Connect+ (the test account cannot: every endpoint below 403s without Connect+).
// ---------------------------------------------------------------------------

/** One serving of a food, as the catalogue and custom foods both report it. */
export interface FoodServing {
  servingId: string;
  /** e.g. `"G"`, `"ML"`, `"OZ"` — see `getCustomFoodServingUnits`. */
  servingUnit: string;
  numberOfUnits: number;
  calories: number;
  carbs?: number;
  protein?: number;
  fat?: number;
  [key: string]: unknown;
}

/** A food, from `searchFoods` (catalogue) or `getCustomFoods` (your own). */
export interface Food {
  foodMetaData: {
    foodId: string;
    foodName: string;
    brandName?: string;
    /** `"GARMIN"` for a custom food; the catalogue's provider (e.g. `"FATSECRET"`) otherwise. */
    source: string;
    regionCode: string;
    languageCode: string;
    [key: string]: unknown;
  };
  nutritionContents: FoodServing[];
  foodImages?: unknown[];
  isFavorite?: boolean;
  [key: string]: unknown;
}

/** `GET /nutrition-service/food/search`. */
export interface FoodSearchResult {
  results: Food[];
  moreDataAvailable: boolean;
}

/** `GET /nutrition-service/customFood`. */
export interface CustomFoodList {
  customFoods: Food[];
  moreDataAvailable: boolean;
}

/** `GET /nutrition-service/food/logs/range` — one entry per day that has a log. */
export interface NutritionFoodLogRange {
  dailyNutritionSummaries: NutritionDailyFoodLog[];
}

/**
 * A custom food's definition, per ONE serving. All nutrients are absolute amounts (grams; sodium,
 * cholesterol, potassium, calcium and iron in mg; vitamin D in mcg), not % of daily value.
 */
export interface CustomFoodInput {
  name: string;
  calories: number;
  /** Default `"G"`. */
  servingUnit?: string;
  /** Size of one serving in `servingUnit`. Default 100. */
  servingSize?: number;
  brand?: string;
  carbs?: number;
  protein?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  saturatedFat?: number;
  transFat?: number;
  sodium?: number;
  cholesterol?: number;
  potassium?: number;
  calcium?: number;
  iron?: number;
  vitaminD?: number;
}

/** Garmin's four default meals. Garmin creates them during the app's nutrition setup. */
export type MealName = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACKS";

/** Which meal an entry goes into, for `logFood` and `quickAddFood`. */
export interface MealSelector {
  /** `YYYY-MM-DD` or a `Date`. */
  date: string | Date;
  /**
   * Local time of day, `"HH:MM"` or `"HH:MM:SS"`. Default: a time inside the chosen meal (LUNCH
   * when no meal is named). Garmin rejects a time that falls in ANOTHER meal's time window (a 400).
   */
  time?: string;
  /** Meal to log into. Default: the meal whose window contains `time`, else SNACKS; LUNCH with no time. */
  meal?: MealName;
}

/** Input to `logFood`: a catalogue or custom food, by the ids `searchFoods`/`getCustomFoods` return. */
export interface FoodLogInput extends MealSelector {
  foodId: string;
  servingId: string;
  /** Number of servings. Default 1. */
  servings?: number;
  /** The food's `foodMetaData.source`: `"GARMIN"` (default) for a custom food. */
  source?: string;
  regionCode?: string;
  languageCode?: string;
}

/** Input to `quickAddFood`: an entry by name and macros, with no food behind it. */
export interface QuickAddInput extends MealSelector {
  name: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
}
