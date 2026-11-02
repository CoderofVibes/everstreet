// The fulfillment worker: a separate operator identity that drains promotion jobs by sending
// signed commands through the same authority check as a person would. When control changes,
// its commands are refused, its jobs wait as "blocked" with the reason, and nothing moves
// until the new owner appoints a worker for the new generation.

import { randomUUID } from "node:crypto";
import type { OperatorIdentity } from "./command.ts";
import { signCommand } from "./command.ts";
import type { CommandOutcome, OpenSeat } from "./service.ts";

export class PromotionWorker {
  generation: number;

  constructor(
    private readonly service: OpenSeat,
    readonly identity: OperatorIdentity,
    generation: number,
  ) {
    this.generation = generation;
  }

  /** Runs every job that is not done once. Returns each attempt's outcome. */
  async drain(): Promise<{ job_id: number; outcome: CommandOutcome }[]> {
    const results: { job_id: number; outcome: CommandOutcome }[] = [];
    for (const job of this.service.pendingJobs()) {
      const signed = signCommand(this.identity, {
        business: this.service.authority.business,
        action: "promote_waitlist",
        args: { job_id: job.id },
        op_id: `promote-${job.id}-${randomUUID()}`,
        generation: this.generation,
      });
      const outcome = await this.service.execute(signed);
      if (!outcome.accepted) this.service.markJob(job.id, "blocked", outcome.reason);
      results.push({ job_id: job.id, outcome });
    }
    return results;
  }
}
