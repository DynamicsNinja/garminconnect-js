/**
 * `GET /trainingplan-service/trainingplan/plans` (`get_training_plans`). Passes through unchecked.
 *
 * This is an ENVELOPE, not an array — observed live as
 * `{ trainingPlanList: [], searchFilter: { ownerId, ownerDisplayName, trainingLevels, ... } }`.
 * The inventory's `returns` column is unreliable in both directions, so `trainingPlanList` is named
 * here because it was actually seen on the wire: it is where the plans live, and a caller reaching
 * for the top-level value as a list gets nothing. Everything else stays under the index signature.
 */
export interface TrainingPlansResult {
  /** Where the plans are. Empty on an account with none. */
  trainingPlanList?: unknown[];
  [key: string]: unknown;
}

/**
 * `GET /trainingplan-service/trainingplan/phased/{plan_id}` (`get_training_plan_by_id`). Passes
 * through unchecked; undocumented shape.
 */
export interface TrainingPlanDetail {
  [key: string]: unknown;
}

/**
 * `GET /trainingplan-service/trainingplan/fbt-adaptive/{plan_id}` (`get_adaptive_training_plan_by_id`).
 * Distinct sub-path (`fbt-adaptive`) from the phased-plan endpoint. Passes through unchecked;
 * undocumented shape.
 */
export interface AdaptiveTrainingPlanDetail {
  [key: string]: unknown;
}
