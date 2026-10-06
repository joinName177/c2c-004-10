import { describe, expect, it } from 'vitest';
import { recoverSnapshot } from '../snapshot-recovery';
import { createSampleSnapshot } from '../sample-data';
import { generatePlans } from '../plan-service';
import { detectRisks } from '../risk-engine';

const validItem = {
  id: 'a', name: '物品A', category: '衣物',
  length: 10, width: 10, height: 5, weight: 0.5,
  priority: 2, mustHave: true, fragile: true,
};

function validSnapshot() {
  return {
    suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
    items: [{ ...validItem }],
    selectedPlan: 'minimal',
  };
}

describe('recoverSnapshot', () => {
  it('passes a valid snapshot through without fixes', () => {
    const result = recoverSnapshot(validSnapshot());
    expect(result.usedSample).toBe(false);
    expect(result.fixes).toEqual([]);
    expect(result.quarantined).toEqual([]);
    expect(result.snapshot).toEqual(validSnapshot());
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['a string', 'text'],
    ['an array', []],
    ['an empty plan', {}],
    ['a broken suitcase', { ...validSnapshot(), suitcase: { length: 0, width: 35, height: 23, maxWeight: 10 } }],
    ['a missing item list', { suitcase: validSnapshot().suitcase, selectedPlan: 'comfort' }],
    ['a non-array item list', { ...validSnapshot(), items: 'nope' }],
  ])('falls back to the sample when key structure is broken: %s', (_label, raw) => {
    const result = recoverSnapshot(raw);
    expect(result.usedSample).toBe(true);
    expect(result.snapshot).toEqual(createSampleSnapshot());
  });

  it('keeps usable items and quarantines broken entries with reasons', () => {
    const result = recoverSnapshot({
      ...validSnapshot(),
      items: [
        { ...validItem },
        { id: 'no-dims', name: '缺尺寸', category: '衣物', weight: 1, priority: 2, mustHave: false },
        { id: 'bad-size', name: '坏尺寸', category: '衣物', length: -3, width: 10, height: 5, weight: 1, priority: 2, mustHave: false },
        { id: 'bad-weight', name: '坏重量', category: '衣物', length: 10, width: 10, height: 5, weight: Number.NaN, priority: 2, mustHave: false },
        { id: 'bad-priority', name: '坏优先级', category: '衣物', length: 10, width: 10, height: 5, weight: 1, priority: 9, mustHave: false },
        { name: '无身份', category: '衣物', length: 10, width: 10, height: 5, weight: 1, priority: 2, mustHave: false },
      ],
    });
    expect(result.usedSample).toBe(false);
    expect(result.snapshot.items.map((item) => item.id)).toEqual(['a']);
    expect(result.quarantined.map((entry) => entry.reason)).toEqual([
      expect.stringContaining('缺少尺寸'),
      expect.stringContaining('尺寸数值无效'),
      expect.stringContaining('重量数值无效'),
      expect.stringContaining('优先级数值无效'),
      expect.stringContaining('身份标识'),
    ]);
  });

  it('keeps the first entry when identities collide', () => {
    const result = recoverSnapshot({
      ...validSnapshot(),
      items: [
        { ...validItem },
        { ...validItem, name: '重复身份', weight: 9 },
      ],
    });
    expect(result.snapshot.items).toHaveLength(1);
    expect(result.snapshot.items[0].name).toBe('物品A');
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].reason).toContain('重复');
    expect(result.quarantined[0].reason).toContain('保留第一条');
  });

  it('resets unknown plan modes to comfort', () => {
    const result = recoverSnapshot({ ...validSnapshot(), selectedPlan: 'deluxe' });
    expect(result.snapshot.selectedPlan).toBe('comfort');
    expect(result.fixes.join()).toContain('deluxe');
    expect(result.fixes.join()).toContain('舒适版');
  });

  it('resets a missing plan mode to comfort', () => {
    const snapshot = validSnapshot() as Record<string, unknown>;
    delete snapshot.selectedPlan;
    const result = recoverSnapshot(snapshot);
    expect(result.snapshot.selectedPlan).toBe('comfort');
    expect(result.fixes.join()).toContain('舒适版');
  });

  it('applies defaults to legacy items missing optional flags', () => {
    const legacy = {
      id: 'old', name: '旧物品', category: '衣物',
      length: 10, width: 10, height: 5, weight: 0.5, priority: 3,
    };
    const result = recoverSnapshot({ ...validSnapshot(), items: [legacy] });
    expect(result.quarantined).toEqual([]);
    expect(result.fixes).toEqual([]);
    expect(result.snapshot.items[0]).toMatchObject({ id: 'old', mustHave: false, fragile: false });
  });

  it('produces a snapshot that plans and risks are computed from consistently', () => {
    const dirty = {
      suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
      items: [
        { ...validItem },
        { id: 'broken', name: '缺尺寸', category: '衣物', weight: 1, priority: 2, mustHave: false },
        { ...validItem, name: '重复身份' },
      ],
      selectedPlan: 'deluxe',
    };
    const { snapshot } = recoverSnapshot(dirty);
    const plans = generatePlans(snapshot.suitcase, snapshot.items);
    const plan = plans[snapshot.selectedPlan];
    const risks = detectRisks(plan, snapshot.suitcase, snapshot.items);
    expect(plan).toBeDefined();
    expect(plan.placements.map((placement) => placement.itemId)).toEqual(['a']);
    expect(risks.length).toBeGreaterThan(0);
  });
});
