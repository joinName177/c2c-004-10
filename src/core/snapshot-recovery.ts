import type { PackingItem, PackingSnapshot, PlanMode, Suitcase } from './models';
import { createSampleSnapshot } from './sample-data';

export const PLAN_MODES: readonly PlanMode[] = ['minimal', 'comfort', 'shopping'];
const DEFAULT_CATEGORY = '未分类';

export interface QuarantinedItem {
  index: number;
  id: string | null;
  name: string | null;
  reason: string;
}

export interface RecoveryReport {
  usedSample: boolean;
  fixes: string[];
  quarantined: QuarantinedItem[];
}

export interface SnapshotRecovery extends RecoveryReport {
  snapshot: PackingSnapshot;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isPriority = (value: unknown): value is 1 | 2 | 3 =>
  value === 1 || value === 2 || value === 3;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

function sampleRecovery(reason: string): SnapshotRecovery {
  return { snapshot: createSampleSnapshot(), usedSample: true, fixes: [reason], quarantined: [] };
}

function sanitizeSuitcase(raw: unknown): Suitcase | null {
  if (!isRecord(raw)) return null;
  const { length, width, height, maxWeight } = raw;
  if (!isPositiveNumber(length) || !isPositiveNumber(width) || !isPositiveNumber(height) || !isPositiveNumber(maxWeight)) return null;
  return { length, width, height, maxWeight };
}

function sanitizeItem(raw: unknown, index: number, seenIds: Set<string>): { item: PackingItem } | { quarantined: QuarantinedItem } {
  const reject = (reason: string): { quarantined: QuarantinedItem } => ({
    quarantined: {
      index,
      id: isRecord(raw) ? asText(raw.id) : null,
      name: isRecord(raw) ? asText(raw.name) : null,
      reason,
    },
  });

  if (!isRecord(raw)) return reject('记录结构无效，不是完整的物品条目');
  const id = asText(raw.id);
  if (!id) return reject('缺少有效的身份标识');
  if (seenIds.has(id)) return reject(`身份标识「${id}」重复，已保留第一条`);
  if ([raw.length, raw.width, raw.height].some((value) => value === undefined || value === null)) {
    return reject('缺少尺寸（需要长、宽、高）');
  }
  if (!isPositiveNumber(raw.length) || !isPositiveNumber(raw.width) || !isPositiveNumber(raw.height)) {
    return reject('尺寸数值无效（长、宽、高需为正数）');
  }
  if (!isPositiveNumber(raw.weight)) return reject('重量数值无效（需为正数）');
  if (!isPriority(raw.priority)) return reject('优先级数值无效（需为 1、2 或 3）');

  seenIds.add(id);
  return {
    item: {
      id,
      name: asText(raw.name) ?? id,
      category: asText(raw.category) ?? DEFAULT_CATEGORY,
      length: raw.length,
      width: raw.width,
      height: raw.height,
      weight: raw.weight,
      priority: raw.priority,
      mustHave: raw.mustHave === true,
      fragile: raw.fragile === true,
    },
  };
}

export function recoverSnapshot(raw: unknown): SnapshotRecovery {
  if (!isRecord(raw)) return sampleRecovery('本地记录不是有效的规划数据');
  const suitcase = sanitizeSuitcase(raw.suitcase);
  if (!suitcase) return sampleRecovery('行李箱箱体数据无效');
  if (!Array.isArray(raw.items)) return sampleRecovery('缺少有效的物品清单');

  const seenIds = new Set<string>();
  const items: PackingItem[] = [];
  const quarantined: QuarantinedItem[] = [];
  raw.items.forEach((entry: unknown, index: number) => {
    const result = sanitizeItem(entry, index, seenIds);
    if ('item' in result) items.push(result.item);
    else quarantined.push(result.quarantined);
  });

  const fixes: string[] = [];
  let selectedPlan: PlanMode = 'comfort';
  if (PLAN_MODES.includes(raw.selectedPlan as PlanMode)) {
    selectedPlan = raw.selectedPlan as PlanMode;
  } else if (raw.selectedPlan === undefined || raw.selectedPlan === null) {
    fixes.push('缺少已选方案，已重置为舒适版');
  } else {
    fixes.push(`未知方案「${String(raw.selectedPlan)}」已重置为舒适版`);
  }

  return { snapshot: { suitcase, items, selectedPlan }, usedSample: false, fixes, quarantined };
}
