import type { GarminClient } from "../client.js";
import type {
  AdaptiveTrainingPlanDetail,
  TrainingPlanDetail,
  TrainingPlansResult,
} from "../types/trainingPlans.js";

/** Training plans: the plan library, a phased plan's detail, an adaptive plan's detail. */
export interface TrainingPlansHost {
  readonly client: GarminClient;
}

/**
 * Upstream `get_training_plans`. `null_behaviour`: passes through unchecked. No parameters.
 */
export async function getTrainingPlans(
  host: TrainingPlansHost,
): Promise<TrainingPlansResult | null> {
  return host.client.connectapi<TrainingPlansResult>(
    "/trainingplan-service/trainingplan/plans",
  );
}

/**
 * Upstream `get_training_plan_by_id`. `null_behaviour`: passes through unchecked.
 */
export async function getTrainingPlanById(
  host: TrainingPlansHost,
  planId: number | string,
): Promise<TrainingPlanDetail | null> {
  return host.client.connectapi<TrainingPlanDetail>(
    `/trainingplan-service/trainingplan/phased/${planId}`,
  );
}

/**
 * Upstream `get_adaptive_training_plan_by_id`. `null_behaviour`: passes through unchecked. Note
 * the distinct sub-path (`fbt-adaptive`) from `getTrainingPlanById`'s `phased` path.
 */
export async function getAdaptiveTrainingPlanById(
  host: TrainingPlansHost,
  planId: number | string,
): Promise<AdaptiveTrainingPlanDetail | null> {
  return host.client.connectapi<AdaptiveTrainingPlanDetail>(
    `/trainingplan-service/trainingplan/fbt-adaptive/${planId}`,
  );
}
