/**
 * `GET /trainingplan-service/trainingplan/plans` (`get_training_plans`). Passes through unchecked;
 * undocumented shape.
 */
export interface TrainingPlansResult {
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
