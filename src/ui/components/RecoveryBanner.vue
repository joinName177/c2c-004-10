<script setup lang="ts">
import { ref } from 'vue';
import type { RecoveryReport } from '../../core/snapshot-recovery';

const props = defineProps<{ report: RecoveryReport }>();
const emit = defineEmits<{ confirm: [] }>();
const showRaw = ref(false);

const title = props.report.status === 'sample' ? '本地规划关键结构无法恢复' : '本地规划已修复部分内容';
const intro = props.report.status === 'sample'
  ? '已临时载入登机箱示例，原始记录保留在下方，确认后才会覆盖。请核对原始内容，需要保留的数据请先手动补录。'
  : '已保留可用物品并临时修复下方问题，方案与风险均基于修复后的清单计算。确认无误后保存，下次打开不再提示。';

async function copyRaw() {
  try {
    await navigator.clipboard.writeText(props.report.rawText);
  } catch {
    // 剪贴板不可用时用户仍可手动选中文本复制
  }
}
</script>

<template>
  <section class="recovery-banner" :data-status="report.status" data-testid="recovery-banner" aria-live="assertive">
    <header>
      <strong>{{ title }}</strong>
      <button type="button" class="primary" data-testid="recovery-confirm" @click="emit('confirm')">确认恢复并保存</button>
    </header>
    <p>{{ intro }}</p>
    <ul class="recovery-notes">
      <li v-for="(note, index) in report.notes" :key="index">{{ note }}</li>
    </ul>
    <div v-if="report.isolated.length" class="recovery-isolated">
      <h4>已隔离条目（未参与装箱计算）</h4>
      <ul>
        <li v-for="entry in report.isolated" :key="entry.key">
          <strong>{{ entry.name || entry.key }}</strong>
          <span v-for="(reason, index) in entry.reasons" :key="index">{{ reason }}</span>
        </li>
      </ul>
    </div>
    <div class="recovery-raw">
      <button type="button" class="link-button" @click="showRaw = !showRaw">
        {{ showRaw ? '隐藏原始内容' : '查看保留的原始内容' }}
      </button>
      <button v-if="showRaw" type="button" class="link-button" @click="copyRaw">复制原文</button>
      <pre v-if="showRaw" data-testid="recovery-raw">{{ report.rawText }}</pre>
    </div>
  </section>
</template>
