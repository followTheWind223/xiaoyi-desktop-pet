<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ArrowUp,
  CircleStop,
  MessageCircleMore,
  Mic,
  Minus,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from '@lucide/vue';
import type {
  ChatErrorCode,
  ChatMessage,
  ChatSnapshot,
  PetProfile,
  RuntimePetState,
} from './types';

const draft = ref('');
const messages = ref<ChatMessage[]>([]);
const pendingReply = ref('');
const activeRequestId = ref<string | null>(null);
const requestPhase = ref<'idle' | 'thinking' | 'speaking'>('idle');
const errorCode = ref<ChatErrorCode | null>(null);
const lastFailedMessage = ref('');
const pet = ref<PetProfile | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);
const thread = ref<HTMLElement | null>(null);
let offProfile: (() => void) | undefined;
let offState: (() => void) | undefined;
let offFocus: (() => void) | undefined;
let offStop: (() => void) | undefined;
let offSnapshot: (() => void) | undefined;
let offChunk: (() => void) | undefined;
let offComplete: (() => void) | undefined;
let offError: (() => void) | undefined;

const busy = computed(() => activeRequestId.value !== null || requestPhase.value !== 'idle');
const title = computed(() => pet.value?.name ?? '桌宠');
const statusCopy = computed(() => {
  if (requestPhase.value === 'thinking') return '正在思考';
  if (requestPhase.value === 'speaking') return '正在回复';
  if (errorCode.value) return '回复遇到问题';
  return messages.value.length ? '最近对话' : '随时可以聊聊';
});

const errorCopies: Partial<Record<ChatErrorCode, string>> = {
  'model-not-configured': '还没有配置可用模型，请先到“模型连接”填写地址和模型名称。',
  'api-key-missing': '还没有安全保存 API Key，请先到“模型连接”完成配置。',
  'api-key-unreadable': 'API Key 无法读取，请在模型设置中重新保存。',
  'secure-storage-unavailable': 'Windows 安全存储当前不可用，暂时无法读取 API Key。',
  'unsafe-endpoint': '模型地址指向本机或内网，已为你阻止这次请求。',
  authentication: '模型鉴权失败，请检查 API Key。',
  'model-or-endpoint-not-found': '没有找到模型或 Chat Completions 接口。',
  'rate-limited': '模型服务正在限流，稍等一会再试吧。',
  'provider-unavailable': '模型服务暂时不可用，请稍后重试。',
  'request-rejected': '模型服务拒绝了这次请求，请检查配置。',
  'invalid-response': '模型返回格式不兼容，请确认支持 Chat Completions。',
  'empty-response': '模型没有返回内容，可以重试一次。',
  'response-too-large': '回复超过安全长度限制，已停止接收。',
  timeout: '等待模型回复超时，可以重试或延长超时时间。',
  network: '无法连接模型服务，请检查网络与地址。',
  busy: '上一条回复还没有结束，请先停止或等待完成。',
  'invalid-message': '这条消息为空或超过长度限制。',
  'pet-unavailable': '当前桌宠还没有准备好，请稍后再试。',
  forbidden: '当前窗口没有发送消息的权限。',
};

const errorCopy = computed(() => (
  errorCode.value ? errorCopies[errorCode.value] ?? '回复失败，请稍后重试。' : ''
));

async function scrollToLatest() {
  await nextTick();
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight;
}

async function resizeInput() {
  await nextTick();
  const element = input.value;
  if (!element) return;
  element.style.height = '42px';
  element.style.height = `${Math.max(42, Math.min(96, element.scrollHeight))}px`;
}

async function focusInput() {
  await nextTick();
  input.value?.focus();
  await resizeInput();
}

function syncBubbleLayout() {
  void window.desktopRuntime?.setBubbleExpanded(Boolean(messages.value.length || busy.value || errorCode.value));
}

function applySnapshot(snapshot: ChatSnapshot) {
  if (snapshot.petId && pet.value?.id && snapshot.petId !== pet.value.id) return;
  messages.value = [...snapshot.messages];
  activeRequestId.value = snapshot.activeRequest?.id ?? null;
  requestPhase.value = snapshot.activeRequest?.status ?? 'idle';
  pendingReply.value = snapshot.activeRequest?.partial ?? '';
  errorCode.value = null;
  syncBubbleLayout();
  void scrollToLatest();
}

async function refreshChat() {
  const snapshot = await window.desktopRuntime?.getChatState();
  if (snapshot) applySnapshot(snapshot);
}

async function stopAnswer() {
  if (!busy.value) return;
  await window.desktopRuntime?.stopChat();
}

async function submit(messageOverride?: string) {
  const message = (messageOverride ?? draft.value).trim();
  if (!message || busy.value) return;
  errorCode.value = null;
  lastFailedMessage.value = message;
  requestPhase.value = 'thinking';
  pendingReply.value = '';
  messages.value.push({
    id: `pending-${Date.now()}`,
    role: 'user',
    content: message,
    createdAt: new Date().toISOString(),
  });
  syncBubbleLayout();
  draft.value = '';
  window.desktopRuntime?.setBubbleHasDraft(false);
  await resizeInput();
  await scrollToLatest();

  let result;
  try {
    result = await window.desktopRuntime?.sendChatMessage(message);
  } catch {
    result = { started: false, error: 'network' as ChatErrorCode };
  }
  if (!result?.started || !result.requestId) {
    activeRequestId.value = null;
    requestPhase.value = 'idle';
    errorCode.value = result?.error ?? 'network';
    syncBubbleLayout();
    return;
  }
  activeRequestId.value = result.requestId;
}

function retryLastMessage() {
  if (!lastFailedMessage.value || busy.value) return;
  const failed = lastFailedMessage.value;
  const last = messages.value[messages.value.length - 1];
  if (last?.role === 'user' && last.content === failed && last.id.startsWith('pending-')) messages.value.pop();
  void submit(failed);
}

async function clearConversation() {
  if (busy.value || !messages.value.length) return;
  if (!window.confirm(`清空与 ${title.value} 的最近对话吗？此操作无法撤销。`)) return;
  if (await window.desktopRuntime?.clearChat()) {
    messages.value = [];
    pendingReply.value = '';
    errorCode.value = null;
    lastFailedMessage.value = '';
    syncBubbleLayout();
    void focusInput();
  }
}

function onInput() {
  window.desktopRuntime?.setBubbleHasDraft(Boolean(draft.value.trim()));
  void resizeInput();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    void window.desktopRuntime?.hidePetBubble();
  }
}

function closeBubble() {
  void window.desktopRuntime?.hidePetBubble();
}

onMounted(async () => {
  offSnapshot = window.desktopRuntime?.onChatSnapshot(applySnapshot);
  offChunk = window.desktopRuntime?.onChatChunk((payload) => {
    if (activeRequestId.value && payload.requestId !== activeRequestId.value) return;
    activeRequestId.value = payload.requestId;
    requestPhase.value = 'speaking';
    pendingReply.value += payload.delta;
    syncBubbleLayout();
    void scrollToLatest();
  });
  offComplete = window.desktopRuntime?.onChatComplete((payload) => {
    if (activeRequestId.value && payload.requestId !== activeRequestId.value) return;
    const pendingUserIndex = messages.value.findIndex((message) => message.id.startsWith('pending-'));
    if (pendingUserIndex !== -1) messages.value[pendingUserIndex].id = `sent-${Date.now()}`;
    if (!messages.value.some((message) => message.id === payload.message.id)) messages.value.push(payload.message);
    activeRequestId.value = null;
    requestPhase.value = 'idle';
    pendingReply.value = '';
    errorCode.value = null;
    syncBubbleLayout();
    void scrollToLatest();
  });
  offError = window.desktopRuntime?.onChatError((payload) => {
    if (activeRequestId.value && payload.requestId !== activeRequestId.value) return;
    if (payload.message && !messages.value.some((message) => message.id === payload.message?.id)) {
      messages.value.push(payload.message);
    }
    activeRequestId.value = null;
    requestPhase.value = 'idle';
    pendingReply.value = '';
    errorCode.value = payload.code === 'cancelled' ? null : payload.code;
    syncBubbleLayout();
    void scrollToLatest();
    void focusInput();
  });

  const snapshot = await window.desktopRuntime?.getDesktopSnapshot();
  if (snapshot?.activePet) pet.value = snapshot.activePet;
  offProfile = window.desktopRuntime?.onPetProfileChanged((profile) => {
    const changed = pet.value?.id !== profile.id;
    pet.value = profile;
    if (changed) void refreshChat();
  });
  offState = window.desktopRuntime?.onPetStateChanged((_next: RuntimePetState) => undefined);
  offFocus = window.desktopRuntime?.onBubbleFocus(() => void focusInput());
  offStop = window.desktopRuntime?.onStopConversation(() => void stopAnswer());
  await refreshChat();
  syncBubbleLayout();
  void focusInput();
});

onBeforeUnmount(() => {
  offProfile?.();
  offState?.();
  offFocus?.();
  offStop?.();
  offSnapshot?.();
  offChunk?.();
  offComplete?.();
  offError?.();
});
</script>

<template>
  <main class="bubble-shell" :style="{ '--pet-accent': pet?.accent ?? '#7381d8' }">
    <section class="bubble-card" aria-label="桌宠文字对话">
      <header class="bubble-header">
        <div class="bubble-identity">
          <span class="bubble-avatar" aria-hidden="true">{{ title.slice(0, 1) }}</span>
          <span><strong>{{ title }}</strong><small aria-live="polite"><i :class="{ busy }" />{{ statusCopy }}</small></span>
        </div>
        <div class="bubble-header-actions">
          <button
            class="bubble-icon-button"
            type="button"
            title="清空最近对话"
            aria-label="清空最近对话"
            :disabled="busy || !messages.length"
            @click="clearConversation"
          >
            <Trash2 :size="15" aria-hidden="true" />
          </button>
          <button class="bubble-icon-button" type="button" aria-label="关闭完整对话" @click="closeBubble">
            <Minus :size="17" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div ref="thread" class="chat-thread" role="log" aria-label="最近对话" aria-live="polite">
        <div v-if="!messages.length && !busy && !errorCode" class="chat-empty">
          <span><MessageCircleMore :size="17" aria-hidden="true" /></span>
          <div><strong>想聊什么都可以</strong><p>发送的文字会交给你配置的模型，回复记录只保存在本机。</p></div>
        </div>

        <article v-for="message in messages" :key="message.id" :class="['chat-message', message.role]">
          <span v-if="message.role === 'assistant'" class="message-mark" aria-hidden="true"><Sparkles :size="12" /></span>
          <p>{{ message.content }}</p>
        </article>

        <article v-if="busy" class="chat-message assistant pending">
          <span class="message-mark" aria-hidden="true"><Sparkles :size="12" /></span>
          <p v-if="pendingReply">{{ pendingReply }}<span class="stream-caret" aria-hidden="true" /></p>
          <div v-else class="thinking-line"><span /><span /><span /><small>正在组织回复</small></div>
        </article>
      </div>

      <div v-if="errorCode" class="chat-error" role="alert">
        <TriangleAlert :size="15" aria-hidden="true" />
        <span>{{ errorCopy }}</span>
        <button v-if="lastFailedMessage" type="button" @click="retryLastMessage">
          <RotateCcw :size="13" aria-hidden="true" />重试
        </button>
      </div>

      <div class="bubble-composer">
        <label class="bubble-input-wrap">
          <span class="sr-only">发送给 {{ title }}</span>
          <textarea
            ref="input"
            v-model="draft"
            name="pet-message"
            rows="1"
            maxlength="1200"
            autocomplete="off"
            placeholder="输入消息…"
            @input="onInput"
            @keydown="onKeydown"
          />
        </label>
        <div class="bubble-actions">
          <button class="bubble-tool-button" type="button" disabled title="本地语音组件接入后开放" aria-label="语音输入暂未接入">
            <Mic :size="17" aria-hidden="true" />
          </button>
          <button v-if="busy" class="bubble-stop-button" type="button" aria-label="停止当前回答" @click="stopAnswer">
            <CircleStop :size="17" aria-hidden="true" />停止
          </button>
          <button v-else class="bubble-send-button" type="button" :disabled="!draft.trim()" aria-label="发送消息" @click="submit()">
            <ArrowUp :size="17" aria-hidden="true" />
          </button>
        </div>
      </div>
      <footer><span>Enter 发送 · Shift + Enter 换行</span><span>{{ draft.length }}/1200</span></footer>
    </section>
  </main>
</template>
