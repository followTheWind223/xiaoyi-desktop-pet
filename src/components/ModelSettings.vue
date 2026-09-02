<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from '@lucide/vue';
import { useConsoleStore } from '../stores/console';
import type { ChatErrorCode } from '../types';
import UiSwitch from './UiSwitch.vue';

const store = useConsoleStore();
const showKey = ref(false);
const endpointMode = ref<'base' | 'full'>('base');
const desktopAvailable = Boolean(window.desktopRuntime?.isDesktop);

const connectionErrors: Partial<Record<ChatErrorCode, string>> = {
  'model-not-configured': '请填写有效的 HTTPS 地址和模型名称',
  'api-key-missing': '请先安全保存 API Key',
  'api-key-unreadable': 'API Key 无法读取，请重新保存',
  'secure-storage-unavailable': 'Windows 安全存储当前不可用',
  'unsafe-endpoint': '地址解析到了本机或内网，已阻止连接',
  authentication: '鉴权失败，请检查 API Key',
  'model-or-endpoint-not-found': '模型名称或接口路径不存在',
  'rate-limited': '服务正在限流，请稍后重试',
  'provider-unavailable': '模型服务暂时不可用',
  'request-rejected': '模型服务拒绝了测试请求',
  'invalid-response': '返回格式不是兼容的 Chat Completions',
  'empty-response': '模型返回了空内容',
  timeout: '连接超时，请检查地址或延长超时时间',
  network: '无法连接模型服务，请检查网络与地址',
};

const connectionCopy = computed(() => {
  switch (store.connectionState) {
    case 'testing': return '正在向模型发送最小测试请求…';
    case 'success': return '连接成功，可以开始与桌宠对话';
    case 'failed': return connectionErrors[store.connectionError ?? 'network'] ?? '模型连接失败，请检查配置';
    default: return '尚未测试模型连接';
  }
});

const keyPlaceholder = computed(() => (
  store.apiKeyStored ? '已安全保存；输入新 Key 可替换' : '输入 API Key'
));

const keyStatusCopy = computed(() => {
  if (!desktopAvailable) return '浏览器开发模式：密钥仅保留在当前页面内存';
  if (store.apiKeySaveState === 'saving') return '正在写入 Windows 安全存储…';
  if (store.apiKeyMessage) return store.apiKeyMessage;
  if (store.apiKeyStored) return '已使用当前 Windows 账户加密保存';
  if (store.apiKeyStorageAvailable) return '尚未保存 API Key';
  return 'Windows 安全存储当前不可用';
});

async function confirmRemoveApiKey() {
  if (window.confirm('确定移除当前 Windows 账户中保存的 API Key 吗？移除后需要重新输入才能连接模型。')) {
    await store.clearApiKey();
  }
}
</script>

<template>
  <section class="page settings-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">模型连接</span>
        <h1>配置 OpenAI 兼容模型</h1>
        <p>这是应用唯一的远程请求；语音识别、语音输出和数据存储均在本地完成。</p>
      </div>
      <button class="primary-button" type="button" :disabled="store.connectionState === 'testing'" @click="store.testConnection">
        <LoaderCircle v-if="store.connectionState === 'testing'" class="spin" :size="16" />
        <PlugZap v-else :size="16" />
        {{ store.connectionState === 'testing' ? '连接中…' : '测试连接' }}
      </button>
    </div>

    <div class="settings-grid">
      <div class="settings-main">
        <article class="settings-card">
          <div class="card-heading">
            <div><h2>连接信息</h2><p>支持 `/v1/chat/completions` 风格接口与流式 SSE。</p></div>
            <span class="protocol-chip">OPENAI PROTOCOL</span>
          </div>

          <div class="two-column-fields">
            <label class="field-label">
              <span>配置名称</span>
              <input v-model="store.llm.profileName" name="llm-profile-name" autocomplete="off" />
            </label>
            <label class="field-label">
              <span>Model Name</span>
              <input v-model="store.llm.modelName" name="llm-model-name" autocomplete="off" spellcheck="false" />
            </label>
          </div>

          <div class="segmented-control" aria-label="地址类型">
            <button type="button" :class="{ active: endpointMode === 'base' }" :aria-pressed="endpointMode === 'base'" @click="endpointMode = 'base'">Base URL</button>
            <button type="button" :class="{ active: endpointMode === 'full' }" :aria-pressed="endpointMode === 'full'" @click="endpointMode = 'full'">完整 Endpoint</button>
          </div>

          <label class="field-label">
            <span>{{ endpointMode === 'base' ? 'Model URL' : 'Chat Completions Endpoint' }}</span>
            <input v-model="store.llm.modelUrl" name="llm-model-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="例如：https://api.example.com/v1…" />
            <small>默认仅接受 HTTPS；禁止在 URL 中携带账号、密码、API Key 或 Token 参数</small>
          </label>

          <div class="field-label api-key-field">
            <span id="api-key-label">API Key</span>
            <div class="secret-input">
              <KeyRound :size="16" aria-hidden="true" />
              <input
                v-model="store.apiKeyDraft"
                :type="showKey ? 'text' : 'password'"
                name="llm-api-key"
                aria-labelledby="api-key-label"
                autocomplete="new-password"
                maxlength="4096"
                :placeholder="keyPlaceholder"
                @keydown.enter="store.saveApiKey"
              />
              <button type="button" :aria-label="showKey ? '隐藏密钥' : '显示密钥'" @click="showKey = !showKey">
                <EyeOff v-if="showKey" :size="17" aria-hidden="true" /><Eye v-else :size="17" aria-hidden="true" />
              </button>
            </div>
            <div class="secure-key-toolbar">
              <div
                :class="['secure-key-status', { stored: store.apiKeyStored, error: store.apiKeySaveState === 'error' }]"
                aria-live="polite"
                aria-atomic="true"
              >
                <ShieldCheck v-if="store.apiKeyStored && store.apiKeySaveState !== 'error'" :size="14" aria-hidden="true" />
                <LockKeyhole v-else :size="14" aria-hidden="true" />
                <span>{{ keyStatusCopy }}</span>
              </div>
              <div class="secure-key-actions">
                <button
                  class="secondary-button secure-key-save"
                  type="button"
                  :disabled="!desktopAvailable || !store.apiKeyStorageAvailable || !store.apiKeyDraft.trim() || store.apiKeySaveState === 'saving'"
                  @click="store.saveApiKey"
                >
                  <LoaderCircle v-if="store.apiKeySaveState === 'saving'" class="spin" :size="14" aria-hidden="true" />
                  <Save v-else :size="14" aria-hidden="true" />
                  {{ store.apiKeyStored ? '替换 API Key' : '安全保存 API Key' }}
                </button>
                <button
                  v-if="store.apiKeyStored"
                  class="secure-key-remove"
                  type="button"
                  :disabled="store.apiKeySaveState === 'saving'"
                  @click="confirmRemoveApiKey"
                >
                  <Trash2 :size="13" aria-hidden="true" />移除已保存密钥
                </button>
              </div>
            </div>
            <small class="secure-copy">
              <LockKeyhole :size="13" aria-hidden="true" />
              密钥不会写入普通配置文件，也不会在界面中回显；更换 Windows 用户或电脑后需重新输入。
            </small>
          </div>
        </article>

        <article class="settings-card">
          <div class="card-heading"><div><h2>生成参数</h2><p>影响角色表达方式与单轮回复长度。</p></div></div>
          <div class="range-field">
            <div><span>Temperature</span><strong>{{ store.llm.temperature.toFixed(1) }}</strong></div>
            <input v-model.number="store.llm.temperature" name="llm-temperature" type="range" min="0" max="1.5" step="0.1" aria-label="Temperature" />
            <small>陪伴角色建议保持在 0.7—0.9，兼顾一致性与自然表达。</small>
          </div>
          <div class="three-column-fields">
            <label class="field-label"><span>最大输出 Token</span><input v-model.number="store.llm.maxOutputTokens" name="llm-max-output-tokens" type="number" inputmode="numeric" min="100" max="4096" autocomplete="off" /></label>
            <label class="field-label"><span>超时时间（秒）</span><input v-model.number="store.llm.timeoutSeconds" name="llm-timeout" type="number" inputmode="numeric" min="5" max="180" autocomplete="off" /></label>
            <label class="field-label"><span>上下文策略</span><select name="llm-context-strategy" autocomplete="off"><option>自动压缩</option><option>仅最近对话</option></select></label>
          </div>
          <div class="switch-stack compact">
            <UiSwitch v-model="store.llm.streaming" label="流式回复" description="收到首句后立即显示并进入本地语音合成" />
            <UiSwitch v-model="store.llm.toolCalling" label="Tool Calling" description="桌面工具功能上线前保持关闭" />
          </div>
        </article>
      </div>

      <aside class="settings-aside">
        <article :class="['connection-card', store.connectionState]" aria-live="polite">
          <CheckCircle2 v-if="store.connectionState === 'success'" :size="22" />
          <TriangleAlert v-else :size="22" />
          <div><strong>{{ connectionCopy }}</strong><span>{{ store.llm.modelUrl }}</span></div>
        </article>
        <article class="privacy-card">
          <LockKeyhole :size="20" />
          <h3>联网边界</h3>
          <p>只有发送给大模型的文本会离开设备。麦克风音频、TTS 音频与数据库不会上传。</p>
          <span class="privacy-link-copy">完整隐私说明将在数据页接入后开放</span>
        </article>
        <article class="storage-card">
          <ShieldCheck :size="20" aria-hidden="true" />
          <h3>本机持久化</h3>
          <p>模型、语音、行为与角色选择会在重启、升级和更换安装目录后继续保留。</p>
          <span>卸载默认保留；可在“对话与数据”页主动清除。</span>
        </article>
      </aside>
    </div>
  </section>
</template>
