import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import type { PackingItem, PackingSnapshot, PlanMode, Suitcase } from '../core/models';
import type { RecoveryReport } from '../core/snapshot-recovery';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PackingSnapshot>(loaded.value);
  const notice = ref('');
  const isStale = ref(false);
  // 结构恢复（修复或回退示例）在用户确认前挂起：期间不写本地记录，避免覆盖原始内容
  const recovery = ref<RecoveryReport | null>(loaded.recovery.status === 'ok' ? null : loaded.recovery);
  const plans = ref(generatePlans(state.suitcase, state.items));
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, state.items));

  // 恢复确认前禁止保存：清单、方案、风险已基于恢复后的同一份有效数据计算，确认后才持久化
  const save = () => { if (!recovery.value) repository.save(JSON.parse(JSON.stringify(state)) as PackingSnapshot); };
  const markStale = () => { isStale.value = true; save(); };

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    markStale();
  }
  function removeItem(id: string) { state.items = state.items.filter((item) => item.id !== id); markStale(); }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }
  function regenerate() { plans.value = generatePlans(state.suitcase, state.items); isStale.value = false; notice.value = '三套方案已重新计算'; save(); }
  function selectPlan(mode: PlanMode) { state.selectedPlan = mode; save(); }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    plans.value = generatePlans(state.suitcase, state.items);
    isStale.value = false;
    recovery.value = null;
    notice.value = '已恢复登机箱示例';
    save();
  }

  function confirmRecovery() {
    // 基于当前（可能已被用户补录或切换方案调整的）同一份有效数据重算方案与风险，再保存
    const selected = state.selectedPlan;
    plans.value = generatePlans(state.suitcase, state.items);
    state.selectedPlan = selected;
    recovery.value = null;
    isStale.value = false;
    notice.value = '本地记录已恢复并保存，下次打开不再重复提示。';
    repository.save(JSON.parse(JSON.stringify(state)) as PackingSnapshot);
  }

  return {
    state, notice, isStale, recovery, plans, currentPlan, risks,
    addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, resetSample, confirmRecovery,
    print: () => printPort.print(),
  };
}
