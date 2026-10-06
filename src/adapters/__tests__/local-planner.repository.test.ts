import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPlannerRepository } from '../local-planner.repository';
import { createSampleSnapshot } from '../../core/sample-data';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('LocalPlannerRepository', () => {
  const storage = new MemoryStorage();
  beforeEach(() => storage.clear());

  it('round trips a planning snapshot', () => {
    const repo = new LocalPlannerRepository(storage);
    const sample = createSampleSnapshot();
    const snapshot = { ...sample, suitcase: { ...sample.suitcase, length: 61 } };
    repo.save(snapshot);
    expect(repo.load().value.suitcase.length).toBe(61);
  });

  it('returns sample data when storage is empty', () => {
    const result = new LocalPlannerRepository(storage).load();
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(result.warning).toBeUndefined();
  });

  it('returns sample data and a warning for malformed JSON', () => {
    storage.setItem('c2c-004.planner', '{bad');
    const result = new LocalPlannerRepository(storage).load();
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(result.warning).toContain('已恢复示例');
  });

  it('falls back to the sample for broken key structure without overwriting the stored content', () => {
    const broken = JSON.stringify({ items: [] });
    storage.setItem('c2c-004.planner', broken);
    const result = new LocalPlannerRepository(storage).load();
    expect(result.recovery?.usedSample).toBe(true);
    expect(result.warning).toContain('已恢复示例');
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(storage.getItem('c2c-004.planner')).toBe(broken);
  });

  it('sanitizes items and unknown plan modes while keeping valid entries', () => {
    const dirty = {
      suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
      items: [
        { id: 'ok', name: '正常物品', category: '衣物', length: 10, width: 10, height: 5, weight: 0.5, priority: 2, mustHave: true },
        { id: 'ok', name: '重复身份', category: '衣物', length: 5, width: 5, height: 5, weight: 0.2, priority: 1, mustHave: false },
        { id: 'broken', name: '缺尺寸', category: '衣物', weight: 1, priority: 2, mustHave: false },
      ],
      selectedPlan: 'deluxe',
    };
    storage.setItem('c2c-004.planner', JSON.stringify(dirty));
    const result = new LocalPlannerRepository(storage).load();
    expect(result.value.selectedPlan).toBe('comfort');
    expect(result.value.items.map((item) => item.id)).toEqual(['ok']);
    expect(result.recovery?.quarantined).toHaveLength(2);
    expect(result.warning).toContain('已隔离 2 条异常物品');
    expect(storage.getItem('c2c-004.planner')).toBe(JSON.stringify(dirty));
  });

  it('loads a clean snapshot without a recovery report', () => {
    const repo = new LocalPlannerRepository(storage);
    repo.save(createSampleSnapshot());
    const result = repo.load();
    expect(result.warning).toBeUndefined();
    expect(result.recovery).toBeUndefined();
  });
});
