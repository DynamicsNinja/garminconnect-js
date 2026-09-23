/** Valid values for `getGoals`' `status` parameter — anything else throws `GarminError`. */
export type GoalStatus = "active" | "future" | "past";

/**
 * One entry of `GET /goal-service/goal/goals` (`get_goals`). The inventory labels the return type
 * "list"; each element's shape is undocumented upstream, so this stays an honest index signature
 * rather than a guessed shape.
 */
export interface Goal {
  [key: string]: unknown;
}
