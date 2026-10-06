import { describe, expect, it } from 'vitest';
import { recoverSnapshot } from '../snapshot-recovery';
import { createSampleSnapshot } from '../sample-data';

const validSuitcase = { length: 52, width: 35, height: 23, maxWeight: 10 };
const item = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a', name: '外套', category: '衣物', length: 30, width: 24, height: 5, weight: 0.65, priority: 3, mustHave: true,
  ...patch,
});
const rawOf = (snapshot: unknown) => JSON.stringify(snapshot);

describe('recoverSnapshot', () => {
  it('keeps a valid snapshot untouched', () => {
    const sample = createSampleSnapshot();
    const result = recoverSnapshot(rawOf(sample));
    expect(result.report.status).toBe('ok');
    expect(result.snapshot).toEqual(sample);
    expect(result.report.notes).toEqual([]);
    expect(result.report.isolated).toEqual([]);
  });

  it('reports malformed JSON as sample fallback and retains the raw text', () => {
    const raw = '{bad json';
    const result = recoverSnapshot(raw);
    expect(result.report.status).toBe('sample');
    expect(result.report.notes[0]).toContain('无法解析');
    expect(result.report.rawText).toBe(raw);
    expect(result.snapshot.items.length).toBeGreaterThan(0);
  });

  it('falls back to sample when the planning object itself is invalid', () => {
    expect(recoverSnapshot('null').report.status).toBe('sample');
    expect(recoverSnapshot('[1,2,3]').report.status).toBe('sample');
    expect(recoverSnapshot('42').report.status).toBe('sample');
  });

  it('falls back to sample when the suitcase is missing or invalid', () => {
    const result = recoverSnapshot(rawOf({ items: [item()] }));
    expect(result.report.status).toBe('sample');
    expect(result.report.notes[0]).toContain('箱体');
    const invalid = recoverSnapshot(rawOf({ suitcase: { ...validSuitcase, width: 0 }, items: [] }));
    expect(invalid.report.status).toBe('sample');
  });

  it('falls back to sample when the item list is missing', () => {
    const result = recoverSnapshot(rawOf({ suitcase: validSuitcase, selectedPlan: 'minimal' }));
    expect(result.report.status).toBe('sample');
    expect(result.report.notes[0]).toContain('物品清单');
    expect(result.report.rawText).toContain('minimal');
  });

  it('accepts an empty but parseable item list', () => {
    const result = recoverSnapshot(rawOf({ suitcase: validSuitcase, items: [] }));
    expect(result.report.status).toBe('repaired');
    expect(result.snapshot.items).toEqual([]);
    expect(result.snapshot.selectedPlan).toBe('comfort');
  });

  it('isolates entries missing dimensions and keeps the usable ones', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [item(), item({ id: 'b', length: undefined }), item({ id: 'c', width: -3 })],
    }));
    expect(result.report.status).toBe('repaired');
    expect(result.snapshot.items.map((i) => i.id)).toEqual(['a']);
    expect(result.report.isolated).toHaveLength(2);
    expect(result.report.isolated[0].reasons).toContain('缺少长度尺寸');
    expect(result.report.isolated[1].reasons).toContain('宽度必须是大于 0 的有效数字');
  });

  it('isolates entries with invalid or non-finite numeric values', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [
        item({ id: 'w', weight: 0 }),
        item({ id: 'n', height: Number.NaN }),
        item({ id: 's', length: '30' }),
      ],
    }));
    expect(result.snapshot.items).toEqual([]);
    const ids = result.report.isolated.map((entry) => entry.key);
    expect(ids).toEqual(['w', 'n', 's']);
    expect(result.report.isolated[0].reasons).toContain('重量必须是大于 0 的有效数字');
    expect(result.report.isolated[2].reasons).toContain('长度必须是大于 0 的有效数字');
  });

  it('keeps the first entry for duplicate identities and isolates later ones', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [
        item({ name: '第一件外套' }),
        item({ id: 'a', name: '重复外套' }),
      ],
    }));
    expect(result.snapshot.items).toHaveLength(1);
    expect(result.snapshot.items[0].name).toBe('第一件外套');
    expect(result.report.isolated).toHaveLength(1);
    expect(result.report.isolated[0].reasons[0]).toContain('重复');
    expect(result.report.isolated[0].reasons[0]).toContain('保留第一条');
  });

  it('isolates entries without a usable identity', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [item({ id: '  ' }), 'not-an-object', item({ id: 'b' })],
    }));
    expect(result.snapshot.items.map((i) => i.id)).toEqual(['b']);
    expect(result.report.isolated[0].reasons).toContain('缺少物品身份（id）');
    expect(result.report.isolated[1].reasons).toContain('物品条目不是有效对象');
    expect(result.report.isolated[0].key).toBe('第 1 条');
  });

  it('resets an unknown selected strategy to comfort', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [item()],
      selectedPlan: 'express',
    }));
    expect(result.snapshot.selectedPlan).toBe('comfort');
    expect(result.report.notes[0]).toContain('不是三种有效策略');
  });

  it('defaults missing mustHave/fragile markers silently and repairs invalid ones', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [
        { id: 'old', name: '旧物品', category: '其他', length: 10, width: 10, height: 2, weight: 0.2, priority: 2 },
        item({ id: 'bad', mustHave: 'yes', fragile: 1 }),
      ],
    }));
    expect(result.snapshot.items[0].mustHave).toBe(false);
    expect(result.snapshot.items[0].fragile).toBe(false);
    expect(result.snapshot.items[1].mustHave).toBe(false);
    expect(result.snapshot.items[1].fragile).toBe(false);
    expect(result.report.notes).toContain('物品“外套”的必带标记无效，已按“可选”处理。');
  });

  it('repairs missing name, category and invalid priority with defaults', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: [item({ id: 'x', name: '  ', category: 9, priority: 7 })],
    }));
    const repaired = result.snapshot.items[0];
    expect(repaired.name).toBe('未命名物品');
    expect(repaired.category).toBe('其他');
    expect(repaired.priority).toBe(2);
    expect(result.report.notes.join(' ')).toContain('未命名物品');
  });

  it('recovered items are always valid packing inputs', () => {
    const result = recoverSnapshot(rawOf({
      suitcase: validSuitcase,
      items: Array.from({ length: 20 }, (_, index) => item({ id: `ok-${index}` }))
        .concat([item({ id: 'dup' }), item({ id: 'dup' }), { nope: true }]),
    }));
    for (const entry of result.snapshot.items) {
      expect(entry.length).toBeGreaterThan(0);
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
      expect(entry.weight).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(entry.priority);
      expect(typeof entry.mustHave).toBe('boolean');
    }
  });
});
