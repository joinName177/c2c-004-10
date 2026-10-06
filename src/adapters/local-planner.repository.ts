import { createSampleSnapshot } from '../core/sample-data';
import { emptyRecoveryReport, recoverSnapshot } from '../core/snapshot-recovery';
import type { PackingSnapshot } from '../core/models';
import type { LoadResult, PlannerRepository } from '../ports/planner-repository.port';

const KEY = 'c2c-004.planner';

export class LocalPlannerRepository implements PlannerRepository {
  constructor(private readonly storage: Storage) {}

  load(): LoadResult<PackingSnapshot> {
    const raw = this.storage.getItem(KEY);
    if (!raw) {
      return { value: createSampleSnapshot(), recovery: emptyRecoveryReport('comfort') };
    }
    const recovered = recoverSnapshot(raw);
    return { value: recovered.snapshot, recovery: recovered.report };
  }

  save(snapshot: PackingSnapshot): void {
    this.storage.setItem(KEY, JSON.stringify(snapshot));
  }
}
