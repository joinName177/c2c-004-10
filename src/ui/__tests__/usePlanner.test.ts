import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { usePlanner } from '../usePlanner';
import { LocalPlannerRepository } from '../../adapters/local-planner.repository';
import type { PackingSnapshot } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  constructor(private snapshot = createSampleSnapshot()) {}
  load() { return { value: structuredClone(this.snapshot) }; }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); }
}

class RecoveryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  load() {
    return {
      value: createSampleSnapshot(),
      warning: '本地数据已修复',
      recovery: { usedSample: false, fixes: [], quarantined: [{ index: 0, id: 'x', name: 'x', reason: '缺少尺寸（需要长、宽、高）' }] },
    };
  }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); }
}

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
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
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });

  it('defers saving until a pending recovery is confirmed', () => {
    const repository = new RecoveryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    expect(planner.pendingRecovery.value).toBe(true);
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    planner.selectPlan('minimal');
    expect(repository.saved).toBeUndefined();
    planner.confirmRecovery();
    expect(planner.pendingRecovery.value).toBe(false);
    expect(repository.saved?.items.some((item) => item.id === 'new')).toBe(true);
    expect(repository.saved?.selectedPlan).toBe('minimal');
  });

  it('builds plans and risks from the same recovered snapshot', () => {
    const storage = new MemoryStorage();
    storage.setItem('c2c-004.planner', JSON.stringify({
      suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
      items: [
        { id: 'lone', name: '孤独物品', category: '衣物', length: 10, width: 10, height: 5, weight: 0.5, priority: 2, mustHave: true },
        { id: 'lone', name: '重复身份', category: '衣物', length: 5, width: 5, height: 5, weight: 0.2, priority: 1, mustHave: false },
        { id: 'broken', name: '缺尺寸', category: '衣物', weight: 1, priority: 2, mustHave: false },
      ],
      selectedPlan: 'deluxe',
    }));
    const planner = usePlanner({ repository: new LocalPlannerRepository(storage), printPort: { print() {} } });
    expect(planner.pendingRecovery.value).toBe(true);
    expect(planner.state.selectedPlan).toBe('comfort');
    expect(planner.state.items.map((item) => item.id)).toEqual(['lone']);
    expect(planner.currentPlan.value).toBeDefined();
    expect(planner.currentPlan.value.placements.map((placement) => placement.itemId)).toEqual(['lone']);
    expect(planner.risks.value.length).toBeGreaterThan(0);
    planner.confirmRecovery();
    expect(new LocalPlannerRepository(storage).load().warning).toBeUndefined();
  });
});
