<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Archive, BrainCircuit, Database, Download, HardDrive, MessageSquareText, Trash2 } from '@lucide/vue';
import { useConsoleStore } from '../stores/console';
import type { CharacterMemoryOverview, PetProfile } from '../types';

const store = useConsoleStore();
const memoryOverview = ref<CharacterMemoryOverview[]>([]);
const totalRecentMessages = computed(() => memoryOverview.value.reduce((sum, item) => sum + item.recentMessages, 0));
const rememberedCharacters = computed(() => memoryOverview.value.filter((item) => item.summaryChars > 0).length);
let disposeMemoryListener: (() => void) | undefined;

function memoryFor(petId: string) {
  return memoryOverview.value.find((item) => item.petId === petId) ?? {
    petId,
    recentMessages: 0,
    summaryChars: 0,
    compressedMessages: 0,
    updatedAt: null,
    status: 'collecting' as const,
  };
}

function memoryDescription(petId: string) {
  const memory = memoryFor(petId);
  if (memory.status === 'compressing') return '正在整理长期记忆…';
  if (memory.status === 'ready') return `已压缩 ${memory.compressedMessages} 条 · 摘要 ${memory.summaryChars} 字`;
  return memory.recentMessages ? `${memory.recentMessages} 条近期消息 · 等待形成摘要` : '尚无对话记忆';
}

function memoryUpdatedAt(petId: string) {
  const value = memoryFor(petId).updatedAt;
  if (!value) return '独立记忆空间';
  return `更新于 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))}`;
}

async function refreshMemoryOverview() {
  memoryOverview.value = await window.desktopRuntime?.getCharacterMemoryOverview() ?? [];
}

async function clearCharacterMemory(pet: PetProfile) {
  const memory = memoryFor(pet.id);
  if (!memory.summaryChars || memory.status === 'compressing') return;
  if (!window.confirm(`确定清除 ${pet.name} 的长期摘要吗？近期对话会保留，其他角色的记忆不受影响。`)) return;
  if (await window.desktopRuntime?.clearCharacterMemory(pet.id)) await refreshMemoryOverview();
}

async function confirmReset() {
  if (window.confirm('确定清除本机数据吗？模型、语音、行为设置、各角色近期对话、长期记忆和已加密的 API Key 都会被移除；已安装角色包会保留。')) {
    await store.resetLocalData();
  }
}

onMounted(() => {
  void refreshMemoryOverview();
  disposeMemoryListener = window.desktopRuntime?.onCharacterMemoryOverviewChanged((overview) => {
    memoryOverview.value = overview;
  });
});

onBeforeUnmount(() => disposeMemoryListener?.());
</script>

<template>
  <section class="page settings-page">
    <div class="page-heading">
      <div><span class="eyebrow">对话与数据</span><h1>每个角色都有自己的记忆</h1><p>近期对话与长期摘要按角色隔离保存在当前用户目录，不会在不同桌宠之间混用。</p></div>
      <button class="secondary-button" type="button" disabled title="SQLite 接入后开放"><Download :size="16" />导出（待接入）</button>
    </div>

    <div class="data-summary-grid">
      <article><MessageSquareText :size="20" /><div><strong>{{ totalRecentMessages }} 条</strong><span>当前近期消息</span></div></article>
      <article><BrainCircuit :size="20" /><div><strong>{{ rememberedCharacters }} 个</strong><span>已形成长期记忆</span></div></article>
      <article><HardDrive :size="20" /><div><strong>2 MB</strong><span>历史文件上限</span></div></article>
    </div>

    <article class="settings-card">
      <div class="card-heading"><div><h2>角色记忆空间</h2><p>达到阈值后使用当前模型在后台整理旧对话，只把当前角色的摘要注入当前会话。</p></div><Database :size="19" /></div>
      <div class="data-pet-list">
        <div v-for="pet in store.pets" :key="pet.id">
          <span class="mini-avatar" :style="{ '--pet-accent': pet.accent }">{{ pet.name.slice(0, 1) }}</span>
          <div><strong>{{ pet.name }}</strong><small>{{ pet.id === store.activePetId ? '当前运行 · ' : '' }}{{ memoryDescription(pet.id) }}</small></div>
          <span>{{ memoryUpdatedAt(pet.id) }}</span>
          <button
            type="button"
            :disabled="memoryFor(pet.id).summaryChars === 0 || memoryFor(pet.id).status === 'compressing'"
            title="仅清除这个角色的长期摘要"
            @click="clearCharacterMemory(pet)"
          >清除记忆</button>
        </div>
      </div>
    </article>

    <article class="settings-card danger-zone">
      <div><Trash2 :size="19" /><span><strong>清除本机数据与密钥</strong><small>移除设置、各角色近期对话、长期记忆和加密 API Key；不会删除已安装角色包。</small></span></div>
      <button class="danger-button" type="button" @click="confirmReset"><Archive :size="15" />清除数据并重置</button>
    </article>
  </section>
</template>
