<script setup lang="ts">
import { Archive, Database, Download, FileClock, HardDrive, MessageSquareText, Trash2 } from '@lucide/vue';
import { useConsoleStore } from '../stores/console';

const store = useConsoleStore();

async function confirmReset() {
  if (window.confirm('确定清除本机数据吗？模型、语音、行为设置、最近对话和已加密的 API Key 都会被移除；已安装角色包会保留。')) {
    await store.resetLocalData();
  }
}
</script>

<template>
  <section class="page settings-page">
    <div class="page-heading">
      <div><span class="eyebrow">对话与数据</span><h1>本地记录与配置管理</h1><p>最近对话按桌宠保存在当前用户目录；API Key 使用 Windows 安全存储单独加密。</p></div>
      <button class="secondary-button" type="button" disabled title="SQLite 接入后开放"><Download :size="16" />导出（待接入）</button>
    </div>

    <div class="data-summary-grid">
      <article><MessageSquareText :size="20" /><div><strong>80 条</strong><span>单角色保留上限</span></div></article>
      <article><FileClock :size="20" /><div><strong>按角色</strong><span>独立对话空间</span></div></article>
      <article><HardDrive :size="20" /><div><strong>2 MB</strong><span>历史文件上限</span></div></article>
    </div>

    <article class="settings-card">
      <div class="card-heading"><div><h2>按桌宠查看</h2><p>切换筛选范围不会改变正在运行的桌宠。</p></div><Database :size="19" /></div>
      <div class="data-pet-list">
        <div v-for="pet in store.pets" :key="pet.id">
          <span class="mini-avatar" :style="{ '--pet-accent': pet.accent }">{{ pet.name.slice(0, 1) }}</span>
          <div><strong>{{ pet.name }}</strong><small>{{ pet.id === store.activePetId ? '当前运行 · ' : '' }}对话记录已启用</small></div>
          <span>本机保存</span>
          <button type="button" disabled title="请从桌宠气泡查看">气泡内查看</button>
        </div>
      </div>
    </article>

    <article class="settings-card danger-zone">
      <div><Trash2 :size="19" /><span><strong>清除本机数据与密钥</strong><small>移除设置、最近对话和加密 API Key；不会删除已安装角色包。</small></span></div>
      <button class="danger-button" type="button" @click="confirmReset"><Archive :size="15" />清除数据并重置</button>
    </article>
  </section>
</template>
