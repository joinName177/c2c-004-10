import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import { LocalPlannerRepository } from '../../adapters/local-planner.repository';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function render(seed?: string) {
  let printCount = 0;
  const storage = new MemoryStorage();
  if (seed !== undefined) storage.setItem('c2c-004.planner', seed);
  const wrapper = mount(App, { props: {
    repository: new LocalPlannerRepository(storage),
    printPort: { print: () => { printCount += 1; } },
  } });
  return { wrapper, storage, getPrintCount: () => printCount };
}

describe('Luggage planner App', () => {
  it('renders sample luggage and catches invalid dimensions', async () => {
    const { wrapper } = render();
    expect(wrapper.text()).toContain('行李箱空间规划师');
    expect(wrapper.text()).toContain('轻薄外套');
    await wrapper.get('[aria-label="行李箱长度"]').setValue('0');
    expect(wrapper.text()).toContain('行李箱长度必须大于 0');
  });

  it('adds and deletes an item', async () => {
    const { wrapper } = render();
    await wrapper.get('[aria-label="物品名称"]').setValue('新物品');
    await wrapper.get('[data-testid="item-editor"]').trigger('submit');
    expect(wrapper.text()).toContain('新物品');
    await wrapper.get('[aria-label="删除 新物品"]').trigger('click');
    expect(wrapper.text()).not.toContain('新物品');
  });

  it('selects a plan and highlights the same item in both projections', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-plan="shopping"]').trigger('click');
    expect(wrapper.get('[data-plan="shopping"]').classes()).toContain('active');
    const jacket = wrapper.findAll('[data-item-id="jacket"]');
    expect(jacket.length).toBe(2);
    await jacket[0].trigger('click');
    expect(wrapper.findAll('[data-item-id="jacket"].selected')).toHaveLength(2);
  });

  it('delegates printing through the print port', async () => {
    const { wrapper, getPrintCount } = render();
    await wrapper.get('[data-testid="print-button"]').trigger('click');
    expect(getPrintCount()).toBe(1);
  });

  it('recovers a structurally damaged record after confirmation and does not repeat the prompt', async () => {
    const damaged = JSON.stringify({
      suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
      items: [
        { id: 'kept', name: '保留物品', category: '其他', length: 20, width: 15, height: 5, weight: 0.4, priority: 2, mustHave: false },
        { id: 'dropped', name: '缺尺寸物品', weight: 0.2 },
      ],
      selectedPlan: 'bogus',
    });
    const { wrapper, storage } = render(damaged);

    expect(wrapper.get('[data-testid="recovery-banner"]').text()).toContain('已修复');
    expect(wrapper.text()).toContain('保留物品');
    // 被隔离的物品不出现在待装清单中，只出现在隔离说明里
    const inventory = wrapper.get('.inventory').text();
    expect(inventory).not.toContain('缺尺寸物品');
    expect(wrapper.get('.recovery-isolated').text()).toContain('缺尺寸物品');
    // 确认前原始内容不被覆盖
    expect(storage.getItem('c2c-004.planner')).toBe(damaged);

    await wrapper.get('[data-testid="recovery-confirm"]').trigger('click');
    expect(wrapper.find('[data-testid="recovery-banner"]').exists()).toBe(false);
    const saved = JSON.parse(storage.getItem('c2c-004.planner') as string);
    expect(saved.items.map((item: { id: string }) => item.id)).toEqual(['kept']);
    expect(saved.selectedPlan).toBe('comfort');

    // 下一次打开不再重复报错
    const reopened = render(storage.getItem('c2c-004.planner') as string);
    expect(reopened.wrapper.find('[data-testid="recovery-banner"]').exists()).toBe(false);
  });

  it('falls back to sample for unrecoverable structure while retaining raw content for review', async () => {
    const raw = JSON.stringify({ items: [], selectedPlan: 'minimal' });
    const { wrapper, storage } = render(raw);
    expect(wrapper.get('[data-testid="recovery-banner"]').text()).toContain('关键结构无法恢复');
    expect(wrapper.find('[data-testid="recovery-raw"]').exists()).toBe(false);
    await wrapper.get('button.link-button').trigger('click');
    expect(wrapper.get('[data-testid="recovery-raw"]').text()).toContain('"selectedPlan":"minimal"');
    expect(storage.getItem('c2c-004.planner')).toBe(raw);
  });
});
