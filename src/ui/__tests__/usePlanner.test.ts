import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { emptyRecoveryReport, recoverSnapshot } from '../../core/snapshot-recovery';
import { usePlanner } from '../usePlanner';
import type { PackingSnapshot } from '../../core/models';
import type { LoadResult, PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  saveCount = 0;
  constructor(private result: LoadResult<PackingSnapshot>) {}

  static fromSnapshot(snapshot: PackingSnapshot = createSampleSnapshot()): MemoryRepository {
    return new MemoryRepository({ value: structuredClone(snapshot), recovery: emptyRecoveryReport(snapshot.selectedPlan) });
  }

  static fromRaw(raw: string): MemoryRepository {
    const recovered = recoverSnapshot(raw);
    return new MemoryRepository({ value: recovered.snapshot, recovery: recovered.report });
  }

  load() { return structuredClone(this.result); }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); this.saveCount += 1; }
}

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = MemoryRepository.fromSnapshot();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    const initial = planner.state.items.length;
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.state.items).toHaveLength(initial + 1);
    expect(planner.isStale.value).toBe(true);
    planner.updateItem('new', { name: '遮阳帽' });
    expect(planner.state.items.find((item) => item.id === 'new')?.name).toBe('遮阳帽');
    planner.removeItem('new');
    expect(planner.state.items).toHaveLength(initial);
  });

  it('regenerates plans and persists the selected mode', () => {
    const repository = MemoryRepository.fromSnapshot();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });

  it('presents a damaged record for confirmation and blocks saves until confirmed', () => {
    const raw = JSON.stringify({
      suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
      items: [
        { id: 'ok', name: '可用物品', category: '其他', length: 20, width: 15, height: 5, weight: 0.4, priority: 2, mustHave: false },
        { id: 'broken', name: '坏条目', length: 10 },
      ],
      selectedPlan: 'weird',
    });
    const repository = MemoryRepository.fromRaw(raw);
    const planner = usePlanner({ repository, printPort: { print() {} } });

    expect(planner.recovery.value?.status).toBe('repaired');
    expect(planner.state.items.map((item) => item.id)).toEqual(['ok']);
    expect(planner.state.selectedPlan).toBe('comfort');
    // 恢复后的清单、方案和风险基于同一份有效数据，不抛异常
    expect(planner.currentPlan.value.id).toBe('comfort');
    expect(Array.isArray(planner.risks.value)).toBe(true);

    planner.addItem({ id: 'later', name: '后加物品', category: '其他', length: 5, width: 5, height: 5, weight: 0.1, priority: 1, mustHave: false });
    planner.regenerate();
    expect(repository.saved).toBeUndefined();
    expect(planner.recovery.value).not.toBeNull();

    planner.confirmRecovery();
    expect(planner.recovery.value).toBeNull();
    expect(repository.saved?.items.map((item) => item.id)).toEqual(['ok', 'later']);
    expect(repository.saved?.selectedPlan).toBe('comfort');
  });

  it('keeps the original raw content when falling back to sample until the user confirms', () => {
    const repository = MemoryRepository.fromRaw('{broken');
    const planner = usePlanner({ repository, printPort: { print() {} } });
    expect(planner.recovery.value?.status).toBe('sample');
    expect(planner.recovery.value?.rawText).toBe('{broken');
    planner.selectPlan('minimal');
    expect(repository.saved).toBeUndefined();

    planner.confirmRecovery();
    expect(repository.saved).toBeDefined();
    // 确认后下一次加载不再报错
    const repairedRaw = JSON.stringify(repository.saved);
    expect(recoverSnapshot(repairedRaw).report.status).toBe('ok');
  });
});
