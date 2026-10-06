import { pathSegment } from "../util/validate.js";
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
    `/trainingplan-service/trainingplan/phased/${pathSegment(planId)}`,
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
    `/trainingplan-service/trainingplan/fbt-adaptive/${pathSegment(planId)}`,
  );
}

/**
 * Quits (removes) an enrolled training plan: `DELETE /trainingplan-service/trainingplan/trainingplan/{planId}`
 * — `trainingplan` twice, the request Garmin Connect's "Quit Plan" sends. Resolves to `null` (204).
 * NOT upstream parity. Its scheduled workouts leave the calendar; activities already done during
 * the plan are kept (Garmin's own confirmation says so). IRREVERSIBLE. `planId` is a plan's
 * `trainingPlanId` from `getTrainingPlans`.
 */
export async function deleteTrainingPlan(host: TrainingPlansHost, planId: number | string): Promise<unknown> {
  return host.client.connectapi(`/trainingplan-service/trainingplan/trainingplan/${pathSegment(planId)}`, {
    method: "DELETE",
  });
}
