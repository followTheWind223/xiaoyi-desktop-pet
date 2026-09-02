<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CharacterAnimationDefinition, CharacterSpriteRuntime } from '../types';

const props = defineProps<{
  sprite: CharacterSpriteRuntime;
  animation: CharacterAnimationDefinition;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let image: HTMLImageElement | null = null;
let animationFrame: number | undefined;
let loadToken = 0;
let frameIndex = 0;
let frameCount = 1;
let lastFrameAt = 0;
let heldAt = 0;
let visible = false;
let observer: IntersectionObserver | undefined;

function stop() {
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  image = null;
  frameIndex = 0;
  frameCount = 1;
  lastFrameAt = 0;
  heldAt = 0;
}

function detectFrameCount(targetImage: HTMLImageElement) {
  const { sprite, animation } = props;
  const frameWidth = sprite.frameWidth ?? Math.floor(targetImage.naturalWidth / sprite.columns);
  const frameHeight = sprite.frameHeight ?? Math.floor(targetImage.naturalHeight / sprite.rows);
  const sample = document.createElement('canvas');
  sample.width = frameWidth;
  sample.height = frameHeight;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return sprite.columns;
  try {
    let lastVisibleColumn = 0;
    for (let column = 0; column < sprite.columns; column += 1) {
      context.clearRect(0, 0, frameWidth, frameHeight);
      context.drawImage(
        targetImage,
        column * frameWidth,
        animation.row * frameHeight,
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
  } catch {
    return sprite.columns;
  }
}

function draw(timestamp: number) {
  const targetImage = image;
  const targetCanvas = canvas.value;
  if (!targetImage || !targetCanvas) return;
  const { sprite, animation } = props;
  const context = targetCanvas.getContext('2d');
  if (!context) return;
  const frameWidth = sprite.frameWidth ?? Math.floor(targetImage.naturalWidth / sprite.columns);
  const frameHeight = sprite.frameHeight ?? Math.floor(targetImage.naturalHeight / sprite.rows);
  const frameDuration = 1000 / Math.max(1, animation.fps ?? sprite.fps);

  if (!lastFrameAt) lastFrameAt = timestamp;
  if (timestamp - lastFrameAt >= frameDuration) {
    if (animation.mode === 'once' && frameIndex >= frameCount - 1) {
      heldAt ||= timestamp;
      if (timestamp - heldAt >= 520) {
        frameIndex = 0;
        heldAt = 0;
      }
    } else {
      frameIndex = (frameIndex + 1) % frameCount;
    }
    lastFrameAt = timestamp;
  }

  targetCanvas.width = frameWidth;
  targetCanvas.height = frameHeight;
  context.clearRect(0, 0, frameWidth, frameHeight);
  context.drawImage(
    targetImage,
    frameIndex * frameWidth,
    animation.row * frameHeight,
    frameWidth,
    frameHeight,
    0,
    0,
    frameWidth,
    frameHeight,
  );
  if (visible && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animationFrame = window.requestAnimationFrame(draw);
  }
}

function load() {
  const token = ++loadToken;
  stop();
  if (!visible) return;
  const nextImage = new Image();
  nextImage.crossOrigin = 'anonymous';
  nextImage.decoding = 'async';
  nextImage.onload = () => {
    if (token !== loadToken) return;
    image = nextImage;
    frameCount = detectFrameCount(nextImage);
    animationFrame = window.requestAnimationFrame(draw);
  };
  nextImage.src = props.sprite.assetUrl;
}

onMounted(() => {
  if (!canvas.value) return;
  observer = new IntersectionObserver(([entry]) => {
    const nextVisible = entry?.isIntersecting === true;
    if (nextVisible === visible) return;
    visible = nextVisible;
    if (visible) load();
    else stop();
  }, { threshold: 0.05 });
  observer.observe(canvas.value);
});
watch(() => [props.sprite.assetUrl, props.animation.id], () => {
  if (visible) load();
});
onBeforeUnmount(() => {
  loadToken += 1;
  observer?.disconnect();
  stop();
});
</script>

<template>
  <canvas ref="canvas" class="motion-preview-canvas" aria-hidden="true" />
</template>
