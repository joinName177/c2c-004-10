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
    const loaded = repo.load();
    expect(loaded.value.suitcase.length).toBe(61);
    expect(loaded.recovery.status).toBe('ok');
  });

  it('returns sample data when storage is empty', () => {
    const result = new LocalPlannerRepository(storage).load();
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(result.recovery.status).toBe('ok');
  });

  it('returns sample data and retains raw text for malformed JSON', () => {
    storage.setItem('c2c-004.planner', '{bad');
    const result = new LocalPlannerRepository(storage).load();
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(result.recovery.status).toBe('sample');
    expect(result.recovery.notes[0]).toContain('无法解析');
    expect(result.recovery.rawText).toBe('{bad');
  });

  it('repairs parseable but structurally damaged records without dropping valid items', () => {
    const valid = {
      id: 'jacket', name: '外套', category: '衣物',
      length: 30, width: 24, height: 5, weight: 0.65, priority: 3, mustHave: true,
    };
    storage.setItem('c2c-004.planner', JSON.stringify({
      suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
      items: [valid, { id: 'broken', height: 4 }],
      selectedPlan: 'express',
    }));
    const result = new LocalPlannerRepository(storage).load();
    expect(result.recovery.status).toBe('repaired');
    expect(result.value.items.map((item) => item.id)).toEqual(['jacket']);
    expect(result.value.selectedPlan).toBe('comfort');
    expect(result.recovery.isolated[0].reasons.join(' ')).toContain('缺少长度尺寸');
  });

  it('does not overwrite the original record on load', () => {
    storage.setItem('c2c-004.planner', '{bad');
    new LocalPlannerRepository(storage).load();
    expect(storage.getItem('c2c-004.planner')).toBe('{bad');
  });
});
