<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowUp, LoaderCircle, LockKeyhole, MessageCircleMore, Settings2, TriangleAlert, X } from '@lucide/vue';
import petReference from './assets/pet-reference.png';
import type {
  CharacterAnimationDefinition,
  ChatErrorCode,
  PetProfile,
  PetUiState,
  RuntimePetState,
} from './types';

const fallbackPet: PetProfile = {
  id: 'pet-xiaoyi',
  name: '小易',
  subtitle: '温柔陪伴型',
  personality: '温柔、耐心，先倾听再回应',
  voice: '晓伊 · 温柔女声',
  wakePhrase: '你好小易',
  accent: '#7381d8',
  avatarKind: 'glyph',
  avatarValue: '易',
  enabled: true,
};

const pet = ref<PetProfile>(fallbackPet);
const state = ref<PetUiState>('idle');
const locked = ref(false);
const hint = ref('');
const previewAnimation = ref<CharacterAnimationDefinition | null>(null);
const spriteCanvas = ref<HTMLCanvasElement | null>(null);
const spriteReady = ref(false);
const quickInputOpen = ref(false);
const quickDraft = ref('');
const quickInput = ref<HTMLInputElement | null>(null);
const quickError = ref('');
const quickReadinessChecking = ref(false);
const quickReadinessError = ref<ChatErrorCode | null>(null);
const quickRequestId = ref<string | null>(null);
const quickSendPending = ref(false);
const speechText = ref('');
const speechVisible = ref(false);
const speechStreaming = ref(false);
const speechBubbleSeconds = ref(10);
const petScale = ref(1);
let hintTimer: number | undefined;
let previewTimer: number | undefined;
let speechTimer: number | undefined;
let longPressTimer: number | undefined;
let pointerStart: { x: number; y: number; screenX: number; screenY: number; at: number } | null = null;
let dragReady = false;
let dragging = false;
let dragStartPromise: Promise<{ started: boolean; reason?: 'locked' | 'invalid' }> | undefined;
let queuedMovePoint: { screenX: number; screenY: number } | null = null;
let moveLoopPromise: Promise<void> | undefined;
let offProfile: (() => void) | undefined;
let offState: (() => void) | undefined;
let offPreviewAnimation: (() => void) | undefined;
let offQuickInputClose: (() => void) | undefined;
let offChatChunk: (() => void) | undefined;
let offChatComplete: (() => void) | undefined;
let offChatError: (() => void) | undefined;
let spriteImage: HTMLImageElement | null = null;
let spriteAnimationFrame: number | undefined;
let spriteLoadToken = 0;
let spriteFrameIndex = 0;
let spriteActiveRow = -1;
let spriteLastFrameAt = 0;
let spriteLastDrawKey = '';
let spriteRowFrameCounts: number[] = [];

const stateLabel = computed(() => {
  if (previewAnimation.value) return `动作预览 · ${previewAnimation.value.label}`;
  return ({
    idle: '',
    hover: '我在这里',
    input_open: '等你输入',
    moving_right: '',
    moving_left: '',
    dragging: locked.value ? '位置已锁定' : '正在移动',
    listening: '正在倾听',
    transcribing: '正在识别',
    thinking: '等待回复…',
    speaking: '正在回答',
    sleeping: '休息中',
    error: '需要帮忙',
  }[state.value]);
});

function applyRuntimeState(next: RuntimePetState) {
  state.value = next.uiState;
  locked.value = next.locked;
  petScale.value = next.petScale ?? 1;
  speechBubbleSeconds.value = next.speechBubbleSeconds ?? 10;
}

const quickErrorCopies: Partial<Record<ChatErrorCode, string>> = {
  'model-not-configured': '请先在控制台配置模型地址与名称。',
  'api-key-missing': '请先在控制台安全保存 API Key。',
  'api-key-unreadable': 'API Key 无法读取，请重新保存。',
  'secure-storage-unavailable': 'Windows 安全存储当前不可用。',
  'unsafe-endpoint': '模型地址不安全，已阻止请求。',
  authentication: '模型鉴权失败，请检查 API Key。',
  'model-or-endpoint-not-found': '没有找到模型或对话接口。',
  'rate-limited': '请求太频繁，请稍后再试。',
  'provider-unavailable': '模型服务暂时不可用。',
  'request-rejected': '模型服务拒绝了本次请求。',
  'invalid-response': '模型返回格式不兼容。',
  'empty-response': '模型没有返回内容。',
  'response-too-large': '回复过长，已停止接收。',
  timeout: '等待回复超时，请重试。',
  network: '无法连接模型服务。',
  busy: '上一条回复还没有结束。',
  'invalid-message': '请输入 1 到 1200 个字符。',
  'pet-unavailable': '桌宠还没有准备好。',
  forbidden: '当前窗口不能发送消息。',
};

const quickSetupCopy = computed(() => {
  if (quickReadinessError.value === 'model-not-configured') return '还没有选择可用模型';
  if (quickReadinessError.value === 'api-key-missing') return '还没有安全保存 API Key';
  if (quickReadinessError.value === 'api-key-unreadable') return 'API Key 需要重新保存';
  if (quickReadinessError.value === 'secure-storage-unavailable') return 'Windows 安全存储暂不可用';
  return '模型配置还没有准备好';
});

function needsModelSetup(error: ChatErrorCode | undefined) {
  return error === 'model-not-configured'
    || error === 'api-key-missing'
    || error === 'api-key-unreadable'
    || error === 'secure-storage-unavailable';
}

function clearSpeechTimer() {
  if (speechTimer) window.clearTimeout(speechTimer);
  speechTimer = undefined;
}

function dismissSpeech() {
  clearSpeechTimer();
  speechVisible.value = false;
  speechStreaming.value = false;
  speechText.value = '';
}

function scheduleSpeechDismiss() {
  clearSpeechTimer();
  speechTimer = window.setTimeout(dismissSpeech, speechBubbleSeconds.value * 1000);
}

function showHint(message: string) {
  hint.value = message;
  if (hintTimer) window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (hint.value = ''), 1800);
}

function clearPreviewAnimation() {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = undefined;
  previewAnimation.value = null;
  spriteActiveRow = -1;
  spriteFrameIndex = 0;
  spriteLastDrawKey = '';
}

function showAnimationPreview(next: CharacterAnimationDefinition) {
  const sprite = pet.value.sprite;
  const registered = sprite?.animations.find((animation) => animation.id === next.id);
  if (!sprite || !registered) return;
  clearPreviewAnimation();
  previewAnimation.value = registered;
  const fps = registered.fps ?? sprite.fps;
  const onePassMs = (sprite.columns / Math.max(1, fps)) * 1000;
  previewTimer = window.setTimeout(clearPreviewAnimation, registered.mode === 'once'
    ? Math.max(900, onePassMs + 260)
    : 2200);
}

async function openInput() {
  if (state.value === 'thinking' || state.value === 'speaking') {
    showHint('正在回复，请稍候');
    return;
  }
  const opened = await window.desktopRuntime?.setQuickInputOpen(true);
  if (opened === false) return;
  dismissSpeech();
  quickError.value = '';
  quickReadinessError.value = null;
  quickReadinessChecking.value = true;
  quickInputOpen.value = true;
  let readiness;
  try {
    readiness = await window.desktopRuntime?.getChatReadiness();
  } catch {
    // If the preflight channel is unavailable, keep the composer usable and let submit surface the error.
  }
  if (!quickInputOpen.value) return;
  quickReadinessChecking.value = false;
  if (readiness && !readiness.ready) {
    quickReadinessError.value = readiness.error ?? 'model-not-configured';
    return;
  }
  await nextTick();
  quickInput.value?.focus();
}

function closeQuickInput(clearDraft = false) {
  quickInputOpen.value = false;
  quickError.value = '';
  quickReadinessChecking.value = false;
  quickReadinessError.value = null;
  if (clearDraft) quickDraft.value = '';
  void window.desktopRuntime?.setQuickInputOpen(false);
}

function openModelSettings() {
  closeQuickInput();
  void window.desktopRuntime?.openModelSettings();
}

async function submitQuickMessage() {
  const message = quickDraft.value.trim();
  if (!message || quickSendPending.value) return;
  quickSendPending.value = true;
  quickError.value = '';
  quickRequestId.value = null;
  dismissSpeech();
  let result;
  try {
    result = await window.desktopRuntime?.sendChatMessage(message);
  } catch {
    result = { started: false, error: 'network' as ChatErrorCode };
  }
  quickSendPending.value = false;
  if (!result?.started || !result.requestId) {
    const error = result?.error ?? 'network';
    if (needsModelSetup(error)) quickReadinessError.value = error;
    else quickError.value = quickErrorCopies[error] ?? '发送失败，请稍后再试。';
    await nextTick();
    quickInput.value?.focus();
    return;
  }
  quickRequestId.value = result.requestId;
  quickDraft.value = '';
  quickInputOpen.value = false;
  void window.desktopRuntime?.setQuickInputOpen(false);
}

function openContextMenu() {
  window.desktopRuntime?.showPetContextMenu();
}

function stopSpriteAnimation() {
  if (spriteAnimationFrame) window.cancelAnimationFrame(spriteAnimationFrame);
  spriteAnimationFrame = undefined;
  spriteImage = null;
  spriteReady.value = false;
  spriteFrameIndex = 0;
  spriteActiveRow = -1;
  spriteLastFrameAt = 0;
  spriteLastDrawKey = '';
  spriteRowFrameCounts = [];
}

function computeRowFrameCounts(image: HTMLImageElement, columns: number, rows: number) {
  const fallback = new Array<number>(rows).fill(columns);
  const frameWidth = Math.floor(image.naturalWidth / columns);
  const frameHeight = Math.floor(image.naturalHeight / rows);
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = frameWidth;
  sampleCanvas.height = frameHeight;
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return fallback;

  try {
    return Array.from({ length: rows }, (_, row) => {
      let lastVisibleColumn = -1;
      for (let column = 0; column < columns; column += 1) {
        context.clearRect(0, 0, frameWidth, frameHeight);
        context.drawImage(
          image,
          column * frameWidth,
          row * frameHeight,
          frameWidth,
          frameHeight,
          0,
          0,
          frameWidth,
          frameHeight,
        );
        const pixels = context.getImageData(0, 0, frameWidth, frameHeight).data;
        let visible = false;
        for (let y = 2; y < frameHeight && !visible; y += 5) {
          for (let x = 2; x < frameWidth; x += 5) {
            if (pixels[((y * frameWidth + x) * 4) + 3] > 4) {
              visible = true;
              break;
            }
          }
        }
        if (visible) lastVisibleColumn = column;
      }
      return Math.max(1, lastVisibleColumn + 1);
    });
  } catch {
    return fallback;
  }
}

function drawSprite(timestamp: number) {
  const sprite = pet.value.sprite;
  const image = spriteImage;
  const canvas = spriteCanvas.value;
  if (!sprite || !image || !canvas) return;

  const context = canvas.getContext('2d');
  if (!context) return;
  const frameWidth = sprite.frameWidth ?? Math.floor(image.naturalWidth / sprite.columns);
  const frameHeight = sprite.frameHeight ?? Math.floor(image.naturalHeight / sprite.rows);
  const stateRow = Math.max(0, Math.min(sprite.rows - 1, sprite.stateRows[state.value] ?? 0));
  const activePreview = previewAnimation.value;
  const activeAnimation = activePreview
    ?? sprite.animations.find((animation) => animation.row === stateRow && animation.states.includes(state.value));
  const nextRow = Math.max(0, Math.min(sprite.rows - 1, activeAnimation?.row ?? stateRow));
  if (nextRow !== spriteActiveRow) {
    spriteActiveRow = nextRow;
    spriteFrameIndex = 0;
    spriteLastFrameAt = timestamp;
    spriteLastDrawKey = '';
  }

  const frameCount = spriteRowFrameCounts[nextRow] ?? sprite.columns;
  const activeMode = !activePreview && (state.value === 'input_open' || state.value === 'hover')
    ? 'loop'
    : activeAnimation?.mode ?? 'loop';
  const activeFps = activeAnimation?.fps ?? sprite.fps;
  const frameDuration = 1000 / Math.max(1, Math.min(30, activeFps));
  if (timestamp - spriteLastFrameAt >= frameDuration) {
    const elapsedFrames = Math.max(1, Math.floor((timestamp - spriteLastFrameAt) / frameDuration));
    spriteFrameIndex = activeMode === 'once'
      ? Math.min(frameCount - 1, spriteFrameIndex + elapsedFrames)
      : (spriteFrameIndex + elapsedFrames) % frameCount;
    spriteLastFrameAt = timestamp;
  }

  const drawKey = `${nextRow}:${spriteFrameIndex}`;
  if (drawKey !== spriteLastDrawKey) {
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.drawImage(
      image,
      spriteFrameIndex * frameWidth,
      nextRow * frameHeight,
      frameWidth,
      frameHeight,
      0,
      0,
      frameWidth,
      frameHeight,
    );
    canvas.dataset.spriteRow = String(nextRow);
    canvas.dataset.spriteFrame = String(spriteFrameIndex);
    canvas.dataset.spriteFrameCount = String(frameCount);
    canvas.dataset.spriteFps = String(activeFps);
    canvas.dataset.spriteAnimation = activeAnimation?.id ?? state.value;
    canvas.dataset.spriteMode = activeMode;
    spriteLastDrawKey = drawKey;
  }

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    spriteAnimationFrame = window.requestAnimationFrame(drawSprite);
  }
}

async function loadActiveSprite() {
  const token = ++spriteLoadToken;
  stopSpriteAnimation();
  const sprite = pet.value.sprite;
  if (pet.value.avatarKind !== 'spritesheet' || !sprite) return;
  await nextTick();

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.onload = () => {
    if (token !== spriteLoadToken) return;
    if (image.naturalWidth !== sprite.width || image.naturalHeight !== sprite.height) {
      showHint('角色图集尺寸发生变化，请重新扫描');
      return;
    }
    spriteImage = image;
    spriteRowFrameCounts = computeRowFrameCounts(image, sprite.columns, sprite.rows);
    spriteReady.value = true;
    spriteAnimationFrame = window.requestAnimationFrame(drawSprite);
  };
  image.onerror = () => {
    if (token === spriteLoadToken) showHint('角色图集加载失败');
  };
  image.src = sprite.assetUrl;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openInput();
  }
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    openContextMenu();
  }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  const press = {
    x: event.clientX,
    y: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    at: performance.now(),
  };
  pointerStart = press;
  dragReady = false;
  dragging = false;
  dragStartPromise = undefined;
  queuedMovePoint = null;
  longPressTimer = window.setTimeout(() => {
    if (pointerStart !== press) return;
    dragReady = true;
    beginDragging(press);
    queuedMovePoint = { screenX: press.screenX, screenY: press.screenY };
    startMoveLoop();
  }, 350);
}

function onPointerEnter() {
  if (!pointerStart && state.value === 'idle') state.value = 'hover';
}

function onPointerLeave() {
  if (!pointerStart && state.value === 'hover') state.value = 'idle';
}

function beginDragging(press = pointerStart) {
  if (!press || dragging) return;
  dragging = true;
  state.value = 'dragging';
  if (longPressTimer) window.clearTimeout(longPressTimer);
  dragStartPromise = window.desktopRuntime?.beginPetMove({
    screenX: press.screenX,
    screenY: press.screenY,
  }) ?? Promise.resolve({ started: false, reason: 'invalid' });
}

function startMoveLoop() {
  if (moveLoopPromise) return;
  moveLoopPromise = (async () => {
    const started = await dragStartPromise;
    if (!started?.started) {
      queuedMovePoint = null;
      if (started?.reason === 'locked') showHint('位置已锁定，可从右键菜单解锁');
      if (state.value === 'dragging') state.value = 'idle';
      return;
    }
    while (queuedMovePoint) {
      const point = queuedMovePoint;
      queuedMovePoint = null;
      const result = await window.desktopRuntime?.movePetWindow(point);
      if (result?.reason === 'locked') {
        showHint('位置已锁定，可从右键菜单解锁');
        break;
      }
    }
  })().finally(() => {
    moveLoopPromise = undefined;
    if (queuedMovePoint) startMoveLoop();
  });
}

function onPointerMove(event: PointerEvent) {
  if (!pointerStart) return;
  const distance = Math.hypot(event.screenX - pointerStart.screenX, event.screenY - pointerStart.screenY);
  if (!dragging && (distance > 6 || dragReady)) {
    beginDragging();
  }
  if (!dragging) return;
  queuedMovePoint = { screenX: event.screenX, screenY: event.screenY };
  startMoveLoop();
}

function finishPointer(event: PointerEvent, cancelled = false) {
  if (!pointerStart) return;
  if (longPressTimer) window.clearTimeout(longPressTimer);
  const elapsed = performance.now() - pointerStart.at;
  const distance = Math.hypot(event.screenX - pointerStart.screenX, event.screenY - pointerStart.screenY);
  const wasDragging = dragging || dragReady;

  pointerStart = null;
  dragReady = false;
  dragging = false;
  const surface = event.currentTarget as HTMLElement;
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  void (async () => {
    while (moveLoopPromise) await moveLoopPromise;
    queuedMovePoint = null;
    dragStartPromise = undefined;
    await window.desktopRuntime?.finishPetMove();
  })();

  if (!cancelled && !wasDragging && elapsed <= 250 && distance <= 6) openInput();
  else state.value = 'idle';
}

onMounted(async () => {
  const snapshot = await window.desktopRuntime?.getDesktopSnapshot();
  if (snapshot?.activePet) pet.value = snapshot.activePet;
  if (snapshot?.runtime) applyRuntimeState(snapshot.runtime);
  offProfile = window.desktopRuntime?.onPetProfileChanged((profile) => (pet.value = profile));
  offState = window.desktopRuntime?.onPetStateChanged(applyRuntimeState);
  offPreviewAnimation = window.desktopRuntime?.onPreviewPetAnimation(showAnimationPreview);
  offQuickInputClose = window.desktopRuntime?.onQuickInputClose(() => {
    quickInputOpen.value = false;
    quickError.value = '';
  });
  offChatChunk = window.desktopRuntime?.onChatChunk((payload) => {
    if (quickRequestId.value && payload.requestId !== quickRequestId.value) return;
    if (!quickRequestId.value && !quickSendPending.value) return;
    quickRequestId.value = payload.requestId;
    clearSpeechTimer();
    speechText.value += payload.delta;
    speechVisible.value = true;
    speechStreaming.value = true;
  });
  offChatComplete = window.desktopRuntime?.onChatComplete((payload) => {
    if (quickRequestId.value && payload.requestId !== quickRequestId.value) return;
    if (!quickRequestId.value && !quickSendPending.value) return;
    quickRequestId.value = null;
    quickSendPending.value = false;
    speechText.value = payload.message.content;
    speechVisible.value = true;
    speechStreaming.value = false;
    scheduleSpeechDismiss();
  });
  offChatError = window.desktopRuntime?.onChatError((payload) => {
    if (quickRequestId.value && payload.requestId !== quickRequestId.value) return;
    if (!quickRequestId.value && !quickSendPending.value) return;
    quickRequestId.value = null;
    quickSendPending.value = false;
    if (payload.message?.content) {
      speechText.value = payload.message.content;
      speechVisible.value = true;
      speechStreaming.value = false;
      scheduleSpeechDismiss();
    } else if (payload.code !== 'cancelled') {
      speechText.value = quickErrorCopies[payload.code] ?? '回复失败，请稍后再试。';
      speechVisible.value = true;
      speechStreaming.value = false;
      scheduleSpeechDismiss();
    }
  });
});

watch(() => pet.value.sprite?.assetUrl, () => void loadActiveSprite());
watch(state, () => {
  clearPreviewAnimation();
  spriteActiveRow = -1;
  spriteFrameIndex = 0;
  spriteLastDrawKey = '';
});

onBeforeUnmount(() => {
  if (hintTimer) window.clearTimeout(hintTimer);
  if (previewTimer) window.clearTimeout(previewTimer);
  clearSpeechTimer();
  if (longPressTimer) window.clearTimeout(longPressTimer);
  spriteLoadToken += 1;
  stopSpriteAnimation();
  offProfile?.();
  offState?.();
  offPreviewAnimation?.();
  offQuickInputClose?.();
  offChatChunk?.();
  offChatComplete?.();
  offChatError?.();
});
</script>

<template>
  <main
    :class="['pet-stage', { 'quick-input-open': quickInputOpen }]"
    :style="{ '--pet-accent': pet.accent, '--pet-window-scale': petScale }"
  >
    <section v-if="speechVisible" class="pet-speech-bubble" aria-label="桌宠回复" aria-live="polite">
      <button type="button" title="关闭回复" aria-label="关闭回复" @click="dismissSpeech"><X :size="12" aria-hidden="true" /></button>
      <p>{{ speechText }}<span v-if="speechStreaming" class="pet-stream-caret" aria-hidden="true" /></p>
    </section>
    <div v-else-if="stateLabel && !quickInputOpen" class="pet-state-pill" aria-live="polite">{{ stateLabel }}</div>
    <div v-if="hint" class="pet-hint" aria-live="polite">
      <LockKeyhole :size="13" aria-hidden="true" />{{ hint }}
    </div>

    <button
      :class="['pet-surface', `state-${state}`]"
      type="button"
      :aria-label="`${pet.name}，单击打开快捷输入，长按拖动，右键打开完整对话与菜单`"
      @keydown="onKeydown"
      @contextmenu.prevent="openContextMenu"
      @pointerenter="onPointerEnter"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finishPointer"
      @pointercancel="finishPointer($event, true)"
      @lostpointercapture="finishPointer($event, true)"
    >
      <span class="pet-aura" aria-hidden="true" />
      <span :class="['pet-art', { 'sprite-art': pet.avatarKind === 'spritesheet' }]" aria-hidden="true">
        <canvas
          v-if="pet.avatarKind === 'spritesheet' && pet.sprite"
          ref="spriteCanvas"
          class="pet-sprite-canvas"
          :class="{ ready: spriteReady }"
          :width="pet.sprite.frameWidth ?? 192"
          :height="pet.sprite.frameHeight ?? 208"
        />
        <img
          v-else-if="pet.avatarKind === 'image'"
          :src="petReference"
          alt=""
          width="172"
          height="172"
          draggable="false"
        />
        <span v-else class="pet-glyph">{{ pet.avatarValue }}</span>
      </span>
      <span class="pet-shadow" aria-hidden="true" />
      <span class="pet-hover-copy"><MessageCircleMore :size="14" aria-hidden="true" />单击快捷对话 · 右键完整对话</span>
    </button>

    <form
      v-if="quickInputOpen"
      class="pet-quick-composer"
      aria-label="快捷对话输入"
      @submit.prevent="submitQuickMessage"
      @contextmenu.prevent="openContextMenu"
      @pointerdown.stop
      @pointerup.stop
    >
      <div v-if="quickReadinessChecking" class="pet-quick-checking" aria-live="polite">
        <LoaderCircle :size="15" aria-hidden="true" />正在检查模型配置…
      </div>
      <div v-else-if="quickReadinessError" class="pet-quick-setup" role="alert">
        <TriangleAlert :size="16" aria-hidden="true" />
        <span><strong>{{ quickSetupCopy }}</strong><small>先完成模型连接，才能开始对话。</small></span>
        <button type="button" @click="openModelSettings"><Settings2 :size="13" aria-hidden="true" />去配置</button>
      </div>
      <div v-else class="pet-quick-input-row">
        <input
          ref="quickInput"
          v-model="quickDraft"
          name="quick-pet-message"
          type="text"
          maxlength="1200"
          autocomplete="off"
          :placeholder="`想和 ${pet.name} 说什么？`"
          @input="quickError = ''"
          @keydown.esc.prevent="closeQuickInput()"
        />
        <button class="pet-quick-close" type="button" title="关闭输入" aria-label="关闭输入" @click="closeQuickInput()">
          <X :size="14" aria-hidden="true" />
        </button>
        <button class="pet-quick-send" type="submit" :disabled="!quickDraft.trim() || quickSendPending" aria-label="发送消息">
          <ArrowUp :size="15" aria-hidden="true" />
        </button>
      </div>
      <small v-if="!quickReadinessChecking && !quickReadinessError && quickError" role="alert">{{ quickError }}</small>
      <small v-else-if="!quickReadinessChecking && !quickReadinessError">Enter 发送 · 右键打开完整对话</small>
    </form>
  </main>
</template>
