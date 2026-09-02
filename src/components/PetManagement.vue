<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Check, ChevronRight, Film, FolderOpen, PackageCheck, Play, Radio, RefreshCw, RotateCcw, Sparkles, TriangleAlert } from '@lucide/vue';
import { useConsoleStore } from '../stores/console';
import PetAvatar from './PetAvatar.vue';
import SpriteAnimationPreview from './SpriteAnimationPreview.vue';

const store = useConsoleStore();
const switchingId = ref<string | null>(null);
const notice = ref('');
const packageScan = computed(() => store.characterScan);
const packageScanning = computed(() => store.packageScanning);
const isDesktop = Boolean(window.desktopRuntime);
const previewingAnimationId = ref<string | null>(null);
let previewNoticeTimer: number | undefined;
const activeAnimations = computed(() => store.activePet.sprite?.animations ?? []);

const isNameValid = computed(() => {
  const length = [...store.activePet.name].length;
  return length >= 2 && length <= 12;
});

async function switchTo(id: string) {
  if (id === store.activePetId || switchingId.value) return;
  switchingId.value = id;
  notice.value = '正在载入新的桌宠配置…';
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  store.switchPet(id);
  switchingId.value = null;
  notice.value = `界面原型已切换到 ${store.activePet.name}，新的唤醒名称已保存`;
  window.setTimeout(() => (notice.value = ''), 2600);
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function scanPackages(showNotice = true) {
  if (!window.desktopRuntime || packageScanning.value) return;
  const result = await store.refreshCharacterPackages();
  if (!result) return;
  if (showNotice) {
    notice.value = result.issues.length
      ? `扫描完成：识别 ${result.packages.length} 个角色包，发现 ${result.issues.length} 个问题`
      : `扫描完成：已识别 ${result.packages.length} 个角色包`;
    window.setTimeout(() => (notice.value = ''), 3200);
  }
}

async function openPackageFolder() {
  const opened = await window.desktopRuntime?.openCharacterPackagesFolder();
  if (opened === false) {
    notice.value = '未能打开角色包目录，请按页面中的路径手动打开';
    window.setTimeout(() => (notice.value = ''), 3200);
  }
}

async function previewAnimation(animationId: string) {
  if (!window.desktopRuntime) return;
  const previewed = await window.desktopRuntime.previewPetAnimation(animationId);
  if (!previewed) {
    notice.value = '动作预览失败，请重新扫描角色包';
    return;
  }
  previewingAnimationId.value = animationId;
  if (previewNoticeTimer) window.clearTimeout(previewNoticeTimer);
  previewNoticeTimer = window.setTimeout(() => (previewingAnimationId.value = null), 2300);
}

onBeforeUnmount(() => {
  if (previewNoticeTimer) window.clearTimeout(previewNoticeTimer);
});

</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">桌宠管理</span>
        <h1>选择今天陪伴你的角色</h1>
        <p>每只桌宠拥有独立名称、人格、音色和对话空间；桌面上始终只运行一只。</p>
      </div>
      <div class="heading-actions">
        <button class="secondary-button" type="button" :disabled="packageScanning || !isDesktop" @click="scanPackages()">
          <RefreshCw :size="16" :class="{ spin: packageScanning }" />{{ packageScanning ? '扫描中' : '重新扫描' }}
        </button>
        <button class="primary-button" type="button" :disabled="!isDesktop" @click="openPackageFolder">
          <FolderOpen :size="16" />打开角色包目录
        </button>
      </div>
    </div>

    <div v-if="notice" class="inline-notice"><Radio :size="16" />{{ notice }}</div>

    <div class="pet-management-layout">
      <div class="pet-list-panel">
        <div class="section-label">
          <span>我的桌宠</span>
          <em>{{ store.pets.length }} 个角色</em>
        </div>

        <article
          v-for="pet in store.pets"
          :key="pet.id"
          :class="['pet-list-card', { active: pet.id === store.activePetId }]"
        >
          <PetAvatar :pet="pet" />
          <div class="pet-card-copy">
            <div>
              <h3>{{ pet.name }}</h3>
              <span v-if="pet.id === store.activePetId" class="active-chip"><Check :size="12" />正在运行</span>
            </div>
            <p>{{ pet.subtitle }} · {{ pet.wakePhrase }}</p>
            <small>{{ pet.voice }}</small>
          </div>
          <button
            v-if="pet.id !== store.activePetId"
            class="switch-pet-button"
            type="button"
            :disabled="Boolean(switchingId)"
            @click="switchTo(pet.id)"
          >
            {{ switchingId === pet.id ? '切换中' : '切换' }}
            <ChevronRight :size="15" />
          </button>
          <span v-else class="live-indicator"><span />LIVE</span>
        </article>

        <div class="package-source-card">
          <div class="package-source-head">
            <span><PackageCheck :size="17" /><strong>本地角色包</strong></span>
            <em>{{ packageScan?.packages.length ?? 0 }} 个已识别</em>
          </div>
          <code>{{ packageScan?.rootPath ?? 'resources/characters' }}</code>

          <div v-if="packageScan?.packages.length" class="package-result-list">
            <div v-for="item in packageScan.packages" :key="item.id">
              <span>
                <strong>{{ item.manifest.displayName }}</strong>
                <small>{{ item.folderName }} / {{ item.manifest.spritesheetPath }}</small>
              </span>
              <em :class="{ ready: item.image.atlas.referenceCompatible }">
                {{ item.image.width }}×{{ item.image.height }} · {{ formatBytes(item.image.bytes) }}
              </em>
            </div>
          </div>
          <p v-else class="package-empty">把 demo 角色文件夹放到上面的路径，然后点击“重新扫描”。</p>

          <div v-if="packageScan?.issues.length" class="package-issues">
            <p v-for="problem in packageScan.issues.slice(0, 3)" :key="`${problem.folderName}:${problem.code}`">
              <TriangleAlert :size="13" />{{ problem.folderName || '角色包目录' }}：{{ problem.message }}
            </p>
          </div>
        </div>
      </div>

      <aside class="pet-detail-panel">
        <div class="detail-preview" :style="{ '--pet-accent': store.activePet.accent }">
          <div class="preview-grid" />
          <PetAvatar :pet="store.activePet" size="large" />
          <span class="preview-status"><span />桌面运行中</span>
        </div>

        <div class="detail-body">
          <div class="section-label"><span>当前桌宠设置</span><em>自动保存</em></div>

          <label class="field-label">
            <span>桌宠名称</span>
            <input
              :value="store.activePet.name"
              name="pet-name"
              autocomplete="off"
              maxlength="12"
              @input="store.updateActivePet({ name: ($event.target as HTMLInputElement).value })"
            />
            <small :class="{ error: !isNameValid }">2—12 个字符，将显示在气泡和控制台中</small>
          </label>

          <label class="field-label">
            <span>唤醒短语</span>
            <div class="input-with-action">
              <input
                :value="store.activePet.wakePhrase"
                name="pet-wake-phrase"
                autocomplete="off"
                maxlength="40"
                @input="store.updateActivePet({ wakePhrase: ($event.target as HTMLInputElement).value })"
              />
              <button type="button">测试</button>
            </div>
            <small>推荐使用“你好 + 名称”，可减少误唤醒</small>
          </label>

          <label class="field-label">
            <span>人格摘要</span>
            <textarea
              rows="3"
              name="pet-personality"
              autocomplete="off"
              maxlength="500"
              :value="store.activePet.personality"
              @input="store.updateActivePet({ personality: ($event.target as HTMLTextAreaElement).value })"
            />
          </label>

          <button class="full-secondary-button" type="button" disabled title="动作映射编辑器后续接入">
            <Sparkles :size="16" />编辑完整人格与动作映射
          </button>
          <button class="text-button" type="button" disabled title="角色运行时接入后开放"><RotateCcw :size="14" />重新加载桌宠资源</button>
        </div>
      </aside>
    </div>

    <article v-if="store.activePet.sprite && activeAnimations.length" class="settings-card motion-library">
      <div class="card-heading motion-library-heading">
        <div>
          <h2><Film :size="17" aria-hidden="true" />完整动作库</h2>
          <p>角色包声明了 {{ activeAnimations.length }} 个动作。选择任一动作可在桌面桌宠上临时预览，不会修改运行设置。</p>
        </div>
        <span>{{ store.activePet.sprite.columns }} 列 × {{ store.activePet.sprite.rows }} 行图集</span>
      </div>
      <div class="motion-strip" aria-label="角色动作预览">
        <button
          v-for="animation in activeAnimations"
          :key="animation.id"
          :class="['motion-tile', { active: previewingAnimationId === animation.id }]"
          type="button"
          :disabled="!isDesktop"
          :aria-pressed="previewingAnimationId === animation.id"
          :aria-label="`预览动作：${animation.label}`"
          @click="previewAnimation(animation.id)"
        >
          <span class="motion-visual">
            <SpriteAnimationPreview :sprite="store.activePet.sprite" :animation="animation" />
            <span class="motion-play"><Play :size="12" aria-hidden="true" /></span>
          </span>
          <strong>{{ animation.label }}</strong>
          <small>第 {{ animation.row + 1 }} 行 · {{ animation.mode === 'once' ? '单次动作' : '循环动作' }}</small>
        </button>
      </div>
    </article>
  </section>
</template>
