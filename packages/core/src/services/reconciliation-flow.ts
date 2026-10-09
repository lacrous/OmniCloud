import type { Repos } from "../repos";
import type { EngineResolver } from "./file-service";
import { ReconciliationService } from "./reconciliation-service";
import { planRepairs, selectApproved, type RepairPlan } from "./reconciliation-repair";
import { ReconciliationApplier, type ApplyResult } from "./reconciliation-apply";

/**
 * The two explicit steps of repair. `plan` reruns the scan and returns the actions
 * that could be approved. `apply` reruns the scan again and applies only the
 * approved ids that the fresh plan still offers, so a plan made against an older
 * channel cannot be applied to a changed one.
 */
export class ReconciliationFlow {
  private readonly reconcile: ReconciliationService;

  constructor(
    private readonly repos: Pick<Repos, "files" | "uploadOperations">,
    private readonly engineFor: EngineResolver,
  ) {
    this.reconcile = new ReconciliationService(repos, engineFor);
  }

  async plan(userId: string): Promise<RepairPlan> {
    return planRepairs(await this.reconcile.run(userId));
  }

  async apply(userId: string, approvedIds: string[]): Promise<ApplyResult> {
    const fresh = await this.plan(userId);
    const selected = selectApproved(fresh, approvedIds);
    const engine = await this.engineFor(userId);
    const applier = new ReconciliationApplier(this.repos, userId, engine);
    return applier.apply(selected);
  }
}
