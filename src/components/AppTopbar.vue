<script setup lang="ts">
import { computed } from 'vue';
import { Check, ChevronDown, Eye, HardDrive, LoaderCircle, MessageCircleMore, TriangleAlert } from '@lucide/vue';
import type { PetProfile, SettingsSaveState } from '../types';

const props = defineProps<{
  pet: PetProfile;
  saveState: SettingsSaveState;
  storageLabel: string;
  desktopAvailable: boolean;
}>();
defineEmits<{
  managePet: [];
  showPet: [];
  openInput: [];
}>();

const saveCopy = computed(() => {
  if (!props.desktopAvailable) {
    if (props.saveState === 'saving') return '正在保存开发配置…';
    if (props.saveState === 'error') return '开发配置保存失败';
    return '开发配置已保存';
  }
  switch (props.saveState) {
    case 'loading': return '正在读取本机配置…';
    case 'saving': return '正在保存到本机…';
    case 'saved': return '已保存到本机';
    case 'error': return '本机保存失败';
    default: return '等待保存';
  }
});
</script>

<template>
  <header class="topbar">
    <div class="active-context">
      <span class="eyebrow">当前运行</span>
      <button class="context-button" type="button" aria-label="管理当前桌宠" @click="$emit('managePet')">
        <span class="mini-avatar" :style="{ '--pet-accent': pet.accent }">{{ pet.name.slice(0, 1) }}</span>
        <strong>{{ pet.name }}</strong>
        <ChevronDown :size="15" aria-hidden="true" />
      </button>
    </div>

    <div class="topbar-actions">
      <div :class="['save-indicator', saveState]" :title="storageLabel" aria-live="polite" aria-atomic="true">
        <LoaderCircle v-if="saveState === 'loading' || saveState === 'saving'" class="spin" :size="14" aria-hidden="true" />
        <TriangleAlert v-else-if="saveState === 'error'" :size="14" aria-hidden="true" />
        <Check v-else-if="saveState === 'saved'" :size="14" aria-hidden="true" />
        <HardDrive v-else :size="14" aria-hidden="true" />
        {{ saveCopy }}
      </div>
      <button class="topbar-command" type="button" :disabled="!desktopAvailable" @click="$emit('openInput')">
        <MessageCircleMore :size="16" aria-hidden="true" />文字对话
      </button>
      <button class="icon-button" type="button" :disabled="!desktopAvailable" aria-label="显示桌宠" @click="$emit('showPet')">
        <Eye :size="18" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
