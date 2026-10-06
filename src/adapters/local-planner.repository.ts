import { createSampleSnapshot } from '../core/sample-data';
import { recoverSnapshot, type RecoveryReport } from '../core/snapshot-recovery';
import type { PackingSnapshot } from '../core/models';
import type { LoadResult, PlannerRepository } from '../ports/planner-repository.port';

const KEY = 'c2c-004.planner';

function describeRecovery(report: RecoveryReport): string {
  if (report.usedSample) {
    return `本地数据无法恢复（${report.fixes.join('；')}），已恢复示例。原始内容仍保留，确认恢复后才会覆盖。`;
  }
  const parts = [...report.fixes];
  if (report.quarantined.length) parts.push(`已隔离 ${report.quarantined.length} 条异常物品`);
  return `本地数据已修复：${parts.join('；')}。原始内容仍保留，确认恢复后才会保存。`;
}

export class LocalPlannerRepository implements PlannerRepository {
  constructor(private readonly storage: Storage) {}

  load(): LoadResult<PackingSnapshot> {
    const raw = this.storage.getItem(KEY);
    if (!raw) return { value: createSampleSnapshot() };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        value: createSampleSnapshot(),
        warning: '本地数据无法读取，已恢复示例。原始内容仍保留，确认恢复后才会覆盖。',
        recovery: { usedSample: true, fixes: ['记录不是有效的 JSON 文本'], quarantined: [] },
      };
    }
    const { snapshot, ...report } = recoverSnapshot(parsed);
    if (!report.usedSample && !report.fixes.length && !report.quarantined.length) {
      return { value: snapshot };
    }
    return { value: snapshot, warning: describeRecovery(report), recovery: report };
  }

  save(snapshot: PackingSnapshot): void {
    this.storage.setItem(KEY, JSON.stringify(snapshot));
  }
}
