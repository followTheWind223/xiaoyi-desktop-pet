<script setup lang="ts">
import { Crosshair, Keyboard, Monitor, Moon, MousePointer2, Move, Sparkles } from '@lucide/vue';
import { useConsoleStore } from '../stores/console';
import UiSwitch from './UiSwitch.vue';

const store = useConsoleStore();
const desktopAvailable = Boolean(window.desktopRuntime?.isDesktop);

function resetPetPosition() {
  void window.desktopRuntime?.resetPetPosition();
}
</script>

<template>
  <section class="page settings-page">
    <div class="page-heading">
      <div><span class="eyebrow">桌面行为</span><h1>控制桌宠如何停留与响应</h1><p>配置置顶、拖拽、吸附、点击穿透和待机动作。</p></div>
      <button class="secondary-button" type="button" :disabled="!desktopAvailable" @click="resetPetPosition"><Crosshair :size="16" aria-hidden="true" />重置桌宠位置</button>
    </div>

    <div class="settings-grid equal">
      <article class="settings-card">
        <div class="card-heading"><div><h2>窗口与位置</h2><p>控制悬浮窗口的桌面行为。</p></div><Monitor :size="19" /></div>
        <div class="switch-stack">
          <UiSwitch v-model="store.behavior.alwaysOnTop" label="始终置顶" description="保持桌宠位于普通窗口上方" />
          <UiSwitch v-model="store.behavior.edgeSnap" label="屏幕边缘吸附" description="拖到边缘时轻微吸附且不会移出屏幕" />
          <UiSwitch v-model="store.behavior.clickThroughShortcut" label="点击穿透快捷键" description="Ctrl + Alt + P 随时恢复或启用" />
          <UiSwitch v-model="store.behavior.startWithSystem" label="开机自动启动" description="登录系统后恢复上次桌宠和位置" />
        </div>
      </article>

      <article class="settings-card">
        <div class="card-heading"><div><h2>交互与动作</h2><p>动作只用于反馈，不打断用户工作。</p></div><Sparkles :size="19" /></div>
        <div class="interaction-cheatsheet">
          <div><MousePointer2 :size="17" /><span><strong>单击</strong>展开文字输入</span></div>
          <div><Move :size="17" /><span><strong>长按拖动</strong>移动桌宠</span></div>
          <div><MousePointer2 :size="17" /><span><strong>右键</strong>快捷菜单与设置</span></div>
          <div><Keyboard :size="17" /><span><strong>Ctrl + Alt + Space</strong>开始语音</span></div>
        </div>
        <div class="switch-stack compact">
          <UiSwitch v-model="store.behavior.idleMotion" label="自然待机动作" description="呼吸、眨眼、观察和低频特殊动作" />
        </div>
      </article>
    </div>

    <article class="settings-card quiet-card">
      <div class="quiet-intro"><Moon :size="20" /><div><h2>勿扰时间</h2><p>只播放低幅度无声动作，不主动弹出气泡。</p></div></div>
      <label class="time-field"><span>开始</span><input v-model="store.behavior.quietStart" name="quiet-start" type="time" autocomplete="off" /></label>
      <span class="time-separator">至</span>
      <label class="time-field"><span>结束</span><input v-model="store.behavior.quietEnd" name="quiet-end" type="time" autocomplete="off" /></label>
      <UiSwitch v-model="store.behavior.quietMode" label="启用勿扰" />
    </article>
  </section>
</template>
