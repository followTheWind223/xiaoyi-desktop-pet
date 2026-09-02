<script setup lang="ts">
import { ref } from 'vue';
import { AudioLines, CircleStop, Headphones, Mic2, Play, Radio, ShieldCheck, Volume2 } from '@lucide/vue';
import { useConsoleStore } from '../stores/console';
import UiSwitch from './UiSwitch.vue';

const store = useConsoleStore();
const testing = ref<'idle' | 'recording' | 'playing'>('idle');

function runTest(mode: 'recording' | 'playing') {
  testing.value = mode;
  window.setTimeout(() => (testing.value = 'idle'), 1800);
}
</script>

<template>
  <section class="page settings-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">语音与唤醒</span>
        <h1>本地语音组件</h1>
        <p>名称唤醒、VAD、SenseVoice 识别和 Kokoro 语音输出全部在设备内运行。</p>
      </div>
      <span class="health-pill planning"><span />4 个组件待接入</span>
    </div>

    <div class="voice-health-grid">
      <article><Radio :size="19" /><div><strong>名称唤醒</strong><span>Open Vocabulary KWS</span></div><em>方案确认</em></article>
      <article><AudioLines :size="19" /><div><strong>语音检测</strong><span>Silero VAD</span></div><em>方案确认</em></article>
      <article><Mic2 :size="19" /><div><strong>语音识别</strong><span>SenseVoiceSmall INT8</span></div><em>待接入</em></article>
      <article><Volume2 :size="19" /><div><strong>语音输出</strong><span>Kokoro INT8</span></div><em>待接入</em></article>
    </div>

    <div class="settings-grid equal">
      <article class="settings-card">
        <div class="card-heading"><div><h2>输入与识别</h2><p>麦克风音频默认不落盘。</p></div><Mic2 :size="19" /></div>
        <label class="field-label"><span>麦克风</span><select v-model="store.voice.inputDevice" name="voice-input-device" autocomplete="off"><option>系统默认麦克风</option><option>麦克风阵列（Realtek Audio）</option><option>耳机麦克风</option></select></label>
        <label class="field-label"><span>识别模型</span><select v-model="store.voice.sttModel" name="voice-stt-model" autocomplete="off"><option>SenseVoiceSmall INT8</option><option disabled>Whisper 兼容模式（后续）</option></select></label>
        <div class="test-surface">
          <div :class="['fake-wave', { active: testing === 'recording' }]" aria-hidden="true">
            <i v-for="index in 18" :key="index" :style="{ '--delay': `${index * 34}ms` }" />
          </div>
          <button class="secondary-button" type="button" @click="runTest('recording')">
            <CircleStop v-if="testing === 'recording'" :size="15" /><Mic2 v-else :size="15" />
            {{ testing === 'recording' ? '交互预览中…' : '预览识别交互' }}
          </button>
        </div>
      </article>

      <article class="settings-card">
        <div class="card-heading"><div><h2>输出与音色</h2><p>当前音色跟随 {{ store.activePet.name }}。</p></div><Headphones :size="19" /></div>
        <label class="field-label"><span>扬声器</span><select v-model="store.voice.outputDevice" name="voice-output-device" autocomplete="off"><option>系统默认扬声器</option><option>扬声器（Realtek Audio）</option><option>蓝牙耳机</option></select></label>
        <label class="field-label"><span>Kokoro 音色</span><select name="voice-speaker" autocomplete="off" :value="store.voice.speaker" @change="store.setActivePetVoice(($event.target as HTMLSelectElement).value)"><option>晓伊 · 温柔女声</option><option>晓晓 · 活泼女声</option><option>云希 · 轻柔男声</option><option>云扬 · 沉稳男声</option></select></label>
        <div class="range-field slim">
          <div><span>语速</span><strong>{{ store.voice.speed.toFixed(1) }}×</strong></div>
          <input v-model.number="store.voice.speed" name="voice-speed" type="range" min="0.7" max="1.3" step="0.1" aria-label="语速" />
        </div>
        <button class="secondary-button full-width" type="button" @click="runTest('playing')">
          <CircleStop v-if="testing === 'playing'" :size="15" /><Play v-else :size="15" />
          {{ testing === 'playing' ? '交互预览中…' : '预览音色交互' }}
        </button>
      </article>
    </div>

    <article class="settings-card horizontal-card">
      <div class="horizontal-copy"><Radio :size="20" /><div><h2>名称唤醒</h2><p>当前短语：<strong>“{{ store.activePet.wakePhrase }}”</strong></p></div></div>
      <div class="sensitivity-control">
        <span>灵敏度</span>
        <div class="segmented-control small">
          <button v-for="level in ['low','medium','high'] as const" :key="level" type="button" :class="{ active: store.voice.wakeSensitivity === level }" :aria-pressed="store.voice.wakeSensitivity === level" @click="store.voice.wakeSensitivity = level">
            {{ { low: '低', medium: '中', high: '高' }[level] }}
          </button>
        </div>
      </div>
      <UiSwitch v-model="store.voice.wakeEnabled" label="持续监听名称" description="只运行本地轻量 KWS" />
      <button class="secondary-button" type="button" disabled title="本地 KWS 接入后开放">开始唤醒测试</button>
    </article>

    <div class="local-assurance"><ShieldCheck :size="17" /><span>架构边界已锁定：正式接入后不会调用远程 STT 或 TTS 服务；当前按钮为界面交互预览。</span></div>
  </section>
</template>
