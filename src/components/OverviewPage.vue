<script setup lang="ts">
import { computed } from 'vue';
import { AudioLines, Bot, MessageCircle, MessageCircleMore, Mic2, ShieldCheck, Sparkles } from '@lucide/vue';
import { useConsoleStore } from '../stores/console';
import PetAvatar from './PetAvatar.vue';

const store = useConsoleStore();
const desktopAvailable = Boolean(window.desktopRuntime?.isDesktop);
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
});

function openPetInput() {
  void window.desktopRuntime?.openPetInput();
}

function showPet() {
  void window.desktopRuntime?.showPet();
}
</script>

<template>
  <section class="page overview-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">运行概览</span>
        <h1>{{ greeting }}，{{ store.activePet.name }} 正在桌面陪伴你</h1>
        <p>桌宠本体、文字气泡、拖拽、原生菜单与点击穿透恢复链路已接入；模型和本地语音仍按阶段推进。</p>
      </div>
      <div class="heading-actions">
        <button class="secondary-button" type="button" :disabled="!desktopAvailable" @click="showPet">显示桌宠</button>
        <button class="primary-button" type="button" :disabled="!desktopAvailable" @click="openPetInput">
          <MessageCircleMore :size="16" aria-hidden="true" />开始文字对话
        </button>
      </div>
    </div>

    <div class="overview-hero">
      <div class="active-pet-portrait">
        <div class="orbit orbit-one" />
        <div class="orbit orbit-two" />
        <PetAvatar :pet="store.activePet" size="large" />
      </div>
      <div class="hero-copy">
        <span class="status-badge success"><span />当前活跃</span>
        <h2>{{ store.activePet.name }}</h2>
        <p>{{ store.activePet.personality }}</p>
        <div class="hero-meta">
          <span><Mic2 :size="15" />{{ store.activePet.wakePhrase }}</span>
          <span><AudioLines :size="15" />{{ store.voice.speaker }}</span>
        </div>
      </div>
      <button class="secondary-button" type="button" @click="store.activeSection = 'voice'">配置语音</button>
    </div>

    <div class="metric-grid">
      <article>
        <div class="metric-icon green"><ShieldCheck :size="20" aria-hidden="true" /></div>
        <div><span>桌面交互</span><strong>纵向链路已接入</strong></div>
        <small>气泡 / 拖拽 / 菜单 / 穿透</small>
      </article>
      <article>
        <div class="metric-icon blue"><Bot :size="20" /></div>
        <div><span>模型连接</span><strong>{{ store.llm.modelName }}</strong></div>
        <small>OpenAI 兼容协议</small>
      </article>
      <article>
        <div class="metric-icon amber"><MessageCircle :size="20" /></div>
        <div><span>原型数据</span><strong>12 轮示例</strong></div>
        <small>SQLite 待接入</small>
      </article>
      <article>
        <div class="metric-icon violet"><Sparkles :size="20" /></div>
        <div><span>待机动作</span><strong>自然模式</strong></div>
        <small>勿扰 23:00—08:00</small>
      </article>
    </div>
  </section>
</template>
