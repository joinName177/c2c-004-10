import type { PackingSnapshot } from '../core/models';
import type { RecoveryReport } from '../core/snapshot-recovery';

export interface LoadResult<T> { value: T; warning?: string; recovery?: RecoveryReport }
export interface PlannerRepository {
  load(): LoadResult<PackingSnapshot>;
  save(snapshot: PackingSnapshot): void;
}
