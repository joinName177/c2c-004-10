import type { PackingItem, PackingSnapshot, PlanMode, Suitcase } from './models';
import { createSampleSnapshot } from './sample-data';

export type RecoveryStatus = 'ok' | 'repaired' | 'sample';

export interface IsolatedEntry {
  /** 用于在清单中定位该条目的标识：有 id 用 id，否则用序号 */
  key: string;
  name?: string;
  reasons: string[];
  raw: unknown;
}

export interface RecoveryReport {
  status: RecoveryStatus;
  /** 面向用户的修复说明，逐条展示 */
  notes: string[];
  /** 被隔离、未进入装箱计算的物品条目及原因 */
  isolated: IsolatedEntry[];
  selectedPlan: PlanMode;
  /** 本地记录的原始文本，关键结构无法恢复时保留供用户确认处理 */
  rawText: string;
}

export interface RecoveredSnapshot {
  snapshot: PackingSnapshot;
  report: RecoveryReport;
}

const PLAN_MODES: ReadonlySet<PlanMode> = new Set<PlanMode>(['minimal', 'comfort', 'shopping']);
const DIMENSION_FIELDS = [
  ['length', '长度'],
  ['width', '宽度'],
  ['height', '高度'],
] as const;

export function emptyRecoveryReport(selectedPlan: PlanMode = 'comfort'): RecoveryReport {
  return { status: 'ok', notes: [], isolated: [], selectedPlan, rawText: '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validSuitcase(value: unknown): value is Suitcase {
  if (!isRecord(value)) return false;
  return positiveFiniteNumber(value.length)
    && positiveFiniteNumber(value.width)
    && positiveFiniteNumber(value.height)
    && positiveFiniteNumber(value.maxWeight);
}

function fallback(raw: string, notes: string[]): RecoveredSnapshot {
  const snapshot = createSampleSnapshot();
  return {
    snapshot,
    report: { status: 'sample', notes, isolated: [], selectedPlan: snapshot.selectedPlan, rawText: raw },
  };
}

/**
 * 在进入装箱计算前恢复本地快照：
 * - 箱体或物品清单等关键结构无法恢复时，临时载入示例并保留原始内容（不自动覆盖）；
 * - 结构可恢复时保留可用物品，隔离缺尺寸、数值无效或身份重复的条目并记录原因；
 * - 未知策略回到舒适版，缺少可选标记的旧物品沿用默认值。
 */
export function recoverSnapshot(raw: string): RecoveredSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fallback(raw, [
      `本地记录无法解析（${(error as Error).message}），已临时载入示例数据。原始内容已保留，确认后才会覆盖。`,
    ]);
  }

  if (!isRecord(parsed)) {
    return fallback(raw, ['本地规划不是有效对象，关键结构无法恢复，已临时载入示例数据。原始内容已保留，确认后才会覆盖。']);
  }
  if (!validSuitcase(parsed.suitcase)) {
    return fallback(raw, ['本地规划缺少尺寸有效的箱体信息，无法在其基础上恢复，已临时载入示例数据。原始内容已保留，确认后才会覆盖。']);
  }
  if (!Array.isArray(parsed.items)) {
    return fallback(raw, ['本地规划缺少物品清单，无法在其基础上恢复，已临时载入示例数据。原始内容已保留，确认后才会覆盖。']);
  }

  const suitcase: Suitcase = {
    length: parsed.suitcase.length,
    width: parsed.suitcase.width,
    height: parsed.suitcase.height,
    maxWeight: parsed.suitcase.maxWeight,
  };

  const notes: string[] = [];
  const isolated: IsolatedEntry[] = [];
  const items: PackingItem[] = [];
  const seenIds = new Set<string>();

  parsed.items.forEach((entry, index) => {
    const key = isRecord(entry) && typeof entry.id === 'string' && entry.id.trim()
      ? entry.id
      : `第 ${index + 1} 条`;
    const name = isRecord(entry) && typeof entry.name === 'string' ? entry.name : undefined;

    if (!isRecord(entry)) {
      isolated.push({ key, name, reasons: ['物品条目不是有效对象'], raw: entry });
      return;
    }

    const reasons: string[] = [];
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      reasons.push('缺少物品身份（id）');
    } else if (seenIds.has(entry.id)) {
      reasons.push(`物品身份“${entry.id}”重复，已保留第一条`);
    }

    for (const [field, label] of DIMENSION_FIELDS) {
      if (!(field in entry)) reasons.push(`缺少${label}尺寸`);
      else if (!positiveFiniteNumber(entry[field])) reasons.push(`${label}必须是大于 0 的有效数字`);
    }
    if (!('weight' in entry)) reasons.push('缺少重量');
    else if (!positiveFiniteNumber(entry.weight)) reasons.push('重量必须是大于 0 的有效数字');

    if (reasons.length) {
      isolated.push({ key, name, reasons, raw: entry });
      return;
    }

    const id = entry.id as string;
    let itemName: string;
    if (typeof entry.name === 'string' && entry.name.trim()) {
      itemName = entry.name;
    } else {
      itemName = '未命名物品';
      notes.push(`物品“${id}”缺少有效名称，已按“未命名物品”处理。`);
    }
    let category: string;
    if (typeof entry.category === 'string' && entry.category.trim()) {
      category = entry.category;
    } else {
      category = '其他';
      notes.push(`物品“${itemName}”缺少有效类别，已归入“其他”。`);
    }
    let priority: 1 | 2 | 3;
    if (entry.priority === 1 || entry.priority === 2 || entry.priority === 3) {
      priority = entry.priority;
    } else {
      priority = 2;
      notes.push(`物品“${itemName}”的优先级无效，已按 P2 处理。`);
    }
    let mustHave = false;
    if (typeof entry.mustHave === 'boolean') mustHave = entry.mustHave;
    else if (entry.mustHave !== undefined) notes.push(`物品“${itemName}”的必带标记无效，已按“可选”处理。`);
    let fragile = false;
    if (typeof entry.fragile === 'boolean') fragile = entry.fragile;
    else if (entry.fragile !== undefined) notes.push(`物品“${itemName}”的易碎标记无效，已按非易碎处理。`);

    seenIds.add(id);
    items.push({
      id,
      name: itemName,
      category,
      length: entry.length as number,
      width: entry.width as number,
      height: entry.height as number,
      weight: entry.weight as number,
      priority,
      mustHave,
      fragile,
    });
  });

  let selectedPlan: PlanMode = 'comfort';
  if (PLAN_MODES.has(parsed.selectedPlan as PlanMode)) {
    selectedPlan = parsed.selectedPlan as PlanMode;
  } else if (parsed.selectedPlan === undefined) {
    notes.push('记录缺少当前方案选择，已回到舒适版。');
  } else {
    notes.push(`当前选择的方案“${String(parsed.selectedPlan)}”不是三种有效策略，已回到舒适版。`);
  }

  if (isolated.length) {
    notes.unshift(`已隔离 ${isolated.length} 条无法使用的物品条目，请在确认后补录或删除。`);
  }

  const status: RecoveryStatus = notes.length || isolated.length ? 'repaired' : 'ok';
  return {
    snapshot: { suitcase, items, selectedPlan },
    report: { status, notes, isolated, selectedPlan, rawText: raw },
  };
}
