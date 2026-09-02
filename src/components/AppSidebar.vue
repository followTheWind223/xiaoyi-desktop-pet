<script setup lang="ts">
import { markRaw } from 'vue';
import {
  AudioLines,
  Bot,
  Database,
  Gauge,
  MonitorCog,
  PawPrint,
  ShieldCheck,
  Sparkles,
} from '@lucide/vue';
import type { SectionKey } from '../types';

defineProps<{ active: SectionKey }>();
const emit = defineEmits<{ select: [key: SectionKey] }>();

const navigation = [
  { key: 'overview' as const, label: '运行概览', icon: markRaw(Gauge) },
  { key: 'pets' as const, label: '桌宠管理', icon: markRaw(PawPrint) },
  { key: 'model' as const, label: '模型连接', icon: markRaw(Bot) },
  { key: 'voice' as const, label: '语音与唤醒', icon: markRaw(AudioLines) },
  { key: 'behavior' as const, label: '桌面行为', icon: markRaw(MonitorCog) },
  { key: 'data' as const, label: '对话与数据', icon: markRaw(Database) },
];
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark"><Sparkles :size="18" /></div>
      <div>
        <strong>桌宠控制台</strong>
        <span>LOCAL COMPANION</span>
      </div>
    </div>

    <nav class="sidebar-nav" aria-label="控制台导航">
      <button
        v-for="item in navigation"
        :key="item.key"
        type="button"
        :class="['nav-item', { active: active === item.key }]"
        :aria-current="active === item.key ? 'page' : undefined"
        @click="emit('select', item.key)"
      >
        <component :is="item.icon" :size="18" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="sidebar-spacer" />

    <div class="coming-soon">
      <div class="coming-icon"><ShieldCheck :size="17" /></div>
      <div>
        <strong>Agent 工具</strong>
        <span>后续版本开放</span>
      </div>
    </div>

    <div class="local-status">
      <span class="status-dot" />
      <div>
        <strong>本地优先模式</strong>
        <span>语音组件待接入 · 仅 LLM 联网</span>
      </div>
    </div>
  </aside>
</template>
