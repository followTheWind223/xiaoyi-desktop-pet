import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type {
  BehaviorSettings,
  CharacterAnimationDefinition,
  CharacterPackage,
  CharacterPackageScanResult,
  ChatErrorCode,
  LlmSettings,
  PersistedConsoleState,
  PetProfile,
  PetUiState,
  SectionKey,
  SettingsSaveState,
  VoiceSettings,
} from '../types';

const STORAGE_KEY = 'desktop-pet-console:v1';

const defaultHatchAnimations: CharacterAnimationDefinition[] = [
  { id: 'idle', label: '待机', row: 0, mode: 'loop', states: ['idle'] },
  { id: 'running-right', label: '向右跑', row: 1, mode: 'loop', states: ['moving_right'] },
  { id: 'running-left', label: '向左跑', row: 2, mode: 'loop', states: ['moving_left'] },
  { id: 'waving', label: '挥手', row: 3, mode: 'once', states: ['hover', 'input_open'] },
  { id: 'jumping', label: '跳跃', row: 4, mode: 'loop', states: ['dragging'] },
  { id: 'failed', label: '失败', row: 5, mode: 'once', states: ['error'] },
  { id: 'waiting', label: '等待', row: 6, mode: 'loop', states: ['listening', 'transcribing', 'thinking', 'sleeping'] },
  { id: 'running', label: '奔跑 / 工作', row: 7, mode: 'loop', states: [] },
  { id: 'review', label: '复盘 / 回答', row: 8, mode: 'loop', states: ['speaking'] },
];

const defaultPets: PetProfile[] = [
  {
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
  },
  {
    id: 'pet-xingye',
    name: '星野',
    subtitle: '活力伙伴型',
    personality: '明快、积极，善于鼓励和庆祝',
    voice: '晓晓 · 活泼女声',
    wakePhrase: '你好星野',
    accent: '#d68a62',
    avatarKind: 'glyph',
    avatarValue: '✦',
    enabled: true,
  },
  {
    id: 'pet-mianmian',
    name: '棉棉',
    subtitle: '安静治愈型',
    personality: '安静、克制，适合低打扰陪伴',
    voice: '云希 · 轻柔男声',
    wakePhrase: '你好棉棉',
    accent: '#6b9b86',
    avatarKind: 'glyph',
    avatarValue: '☁',
    enabled: true,
  },
];

const defaultLlm: LlmSettings = {
  profileName: '默认模型',
  modelUrl: 'https://api.example.com/v1',
  modelName: 'your-model-name',
  temperature: 0.8,
  maxOutputTokens: 800,
  timeoutSeconds: 45,
  streaming: true,
  toolCalling: false,
};

const defaultVoice: VoiceSettings = {
  inputDevice: '系统默认麦克风',
  outputDevice: '系统默认扬声器',
  sttModel: 'SenseVoiceSmall INT8',
  ttsModel: 'Kokoro multilingual v1.1 INT8',
  speaker: '晓伊 · 温柔女声',
  speed: 1,
  wakeSensitivity: 'medium',
  wakeEnabled: true,
  localOnly: true,
};

const defaultBehavior: BehaviorSettings = {
  alwaysOnTop: true,
  edgeSnap: true,
  startWithSystem: false,
  movementEnabled: true,
  idleMotion: true,
  speechBubbleSeconds: 10,
  clickThroughShortcut: true,
  quietMode: true,
  quietStart: '23:00',
  quietEnd: '08:00',
};

function loadState(): PersistedConsoleState {
  const fallback: PersistedConsoleState = {
    activePetId: defaultPets[0].id,
    pets: defaultPets,
    llm: defaultLlm,
    voice: defaultVoice,
    behavior: defaultBehavior,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedConsoleState>;
    return {
      activePetId: parsed.activePetId ?? fallback.activePetId,
      pets: parsed.pets?.length ? parsed.pets : fallback.pets,
      llm: { ...fallback.llm, ...parsed.llm },
      voice: { ...fallback.voice, ...parsed.voice },
      behavior: { ...fallback.behavior, ...parsed.behavior },
    };
  } catch {
    return fallback;
  }
}

function safeModelUrlForStorage(value: string) {
  try {
    const url = new URL(value);
    const hasSensitiveQuery = [...url.searchParams.keys()].some((key) =>
      /api[-_]?key|access[-_]?token|secret|password|authorization/i.test(key),
    );
    if (url.protocol !== 'https:' || url.username || url.password || hasSensitiveQuery) return '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function packageAccent(id: string) {
  const palette = ['#6f9fcb', '#8c83c8', '#6b9b86', '#c48276', '#9b855f'];
  const hash = [...id].reduce((value, character) => ((value * 31) + character.codePointAt(0)!) >>> 0, 0);
  return palette[hash % palette.length];
}

function localizedPackageDescription(value: string | undefined, fallback: string) {
  const description = value?.trim();
  if (!description) return fallback;
  const chineseSentence = description
    .split(/[.!?。！？]+/u)
    .map((segment) => segment.trim())
    .find((segment) => /[\u3400-\u9fff]/u.test(segment));
  return chineseSentence ? `${chineseSentence}。` : description;
}

function characterAnimations(characterPackage: CharacterPackage): CharacterAnimationDefinition[] {
  const rows = characterPackage.image.atlas.rows;
  const source = characterPackage.manifest.animations?.length
    ? characterPackage.manifest.animations
    : defaultHatchAnimations;
  return source
    .filter((animation) => animation.row >= 0 && animation.row < rows)
    .map((animation) => {
      const conventionalState: PetUiState | null = animation.id === 'running-right'
        ? 'moving_right'
        : animation.id === 'running-left' ? 'moving_left' : null;
      return {
        ...animation,
        states: conventionalState && !animation.states.includes(conventionalState)
          ? [...animation.states, conventionalState]
          : [...animation.states],
      };
    });
}

function characterPackageToPet(characterPackage: CharacterPackage): PetProfile {
  const behavior = characterPackage.manifest.behavior ?? {};
  const animations = characterAnimations(characterPackage);
  const stateRows = {
    idle: behavior.idleRows?.[0] ?? 0,
    hover: 3,
    input_open: 3,
    moving_right: behavior.walkRightRow ?? 1,
    moving_left: behavior.walkLeftRow ?? 2,
    dragging: behavior.draggingRow ?? 4,
    listening: 6,
    transcribing: 6,
    thinking: behavior.thinkingRow ?? 6,
    speaking: behavior.talkingRow ?? 8,
    sleeping: 6,
    error: 5,
  } satisfies Record<PetUiState, number>;
  for (const animationState of Object.keys(stateRows) as PetUiState[]) {
    stateRows[animationState] = Math.max(0, Math.min(characterPackage.image.atlas.rows - 1, stateRows[animationState]));
  }
  if (characterPackage.manifest.animations?.length) {
    const assignedStates = new Set<PetUiState>();
    for (const animation of animations) {
      for (const animationState of animation.states) {
        if (!assignedStates.has(animationState)) {
          stateRows[animationState] = animation.row;
          assignedStates.add(animationState);
        }
      }
    }
  }
  const displayName = [...characterPackage.manifest.displayName].slice(0, 12).join('');
  return {
    id: characterPackage.id,
    name: displayName,
    subtitle: '动态角色包',
    personality: localizedPackageDescription(
      characterPackage.manifest.description,
      `${displayName} 的本地桌宠角色包`,
    ),
    voice: '系统默认音色',
    wakePhrase: `你好${displayName}`,
    accent: packageAccent(characterPackage.id),
    avatarKind: 'spritesheet',
    avatarValue: [...displayName][0] ?? '宠',
    enabled: true,
    source: 'character-package',
    packageId: characterPackage.id,
    sprite: {
      assetUrl: characterPackage.assetUrl,
      width: characterPackage.image.width,
      height: characterPackage.image.height,
      columns: characterPackage.image.atlas.columns,
      rows: characterPackage.image.atlas.rows,
      frameWidth: characterPackage.image.atlas.frameWidth,
      frameHeight: characterPackage.image.atlas.frameHeight,
      fps: behavior.fps ?? 6,
      stateRows,
      animations,
    },
  };
}

function petForDesktopRuntime(pet: PetProfile): PetProfile {
  return {
    ...pet,
    ...(pet.sprite ? {
      sprite: {
        ...pet.sprite,
        stateRows: { ...pet.sprite.stateRows },
        animations: pet.sprite.animations.map((animation) => ({
          ...animation,
          states: [...animation.states],
        })),
      },
    } : {}),
  };
}

export const useConsoleStore = defineStore('console', () => {
  const initial = loadState();
  const initialLocalPets = initial.pets.filter((pet) => pet.source !== 'character-package');
  const desktopRuntime = window.desktopRuntime;
  let settingsHydrated = !desktopRuntime;
  let saveRevision = 0;
  const activeSection = ref<SectionKey>('overview');
  const activePetId = ref(initial.activePetId);
  const pets = ref(initialLocalPets.length ? initialLocalPets : defaultPets);
  const llm = ref(initial.llm);
  const voice = ref(initial.voice);
  const behavior = ref(initial.behavior);
  const apiKeyDraft = ref('');
  const apiKeyStored = ref(false);
  const apiKeyStorageAvailable = ref(false);
  const apiKeyProvider = ref('session-memory');
  const apiKeySaveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const apiKeyMessage = ref('');
  const saveState = ref<SettingsSaveState>(desktopRuntime ? 'loading' : 'saved');
  const connectionState = ref<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const connectionError = ref<ChatErrorCode | null>(null);
  const characterScan = ref<CharacterPackageScanResult | null>(null);
  const packageScanning = ref(false);

  const activePet = computed(() =>
    pets.value.find((pet) => pet.id === activePetId.value) ?? pets.value[0],
  );
  const configurationStorageLabel = computed(() => (
    desktopRuntime ? '本机用户配置' : '浏览器开发配置'
  ));

  function settingsSnapshot(): PersistedConsoleState {
    return {
      activePetId: activePetId.value,
      pets: pets.value
        .filter((pet) => pet.source !== 'character-package')
        .map(petForDesktopRuntime),
      llm: {
        ...llm.value,
        modelUrl: safeModelUrlForStorage(llm.value.modelUrl),
      },
      voice: { ...voice.value },
      behavior: { ...behavior.value },
    };
  }

  function applyPersistedSettings(next: PersistedConsoleState) {
    const localPets = next.pets.filter((pet) => pet.source !== 'character-package');
    activePetId.value = next.activePetId;
    pets.value = localPets.length ? localPets : defaultPets.map((pet) => ({ ...pet }));
    llm.value = { ...defaultLlm, ...next.llm };
    voice.value = { ...defaultVoice, ...next.voice };
    behavior.value = { ...defaultBehavior, ...next.behavior };
  }

  function syncDesktopRuntime() {
    void window.desktopRuntime?.syncConsoleState({
      activePetId: activePetId.value,
      pets: pets.value.map(petForDesktopRuntime),
      llm: { ...llm.value },
      behavior: { ...behavior.value },
    });
  }

  async function persist() {
    if (!settingsHydrated) return;
    const payload = settingsSnapshot();
    saveState.value = 'saving';
    syncDesktopRuntime();
    const revision = ++saveRevision;
    if (desktopRuntime) {
      try {
        const result = await desktopRuntime.saveConsoleSettings(payload);
        if (revision === saveRevision) saveState.value = result.saved ? 'saved' : 'error';
      } catch {
        if (revision === saveRevision) saveState.value = 'error';
      }
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      if (revision === saveRevision) saveState.value = 'saved';
    } catch {
      if (revision === saveRevision) saveState.value = 'error';
    }
  }

  watch([activePetId, pets, llm, voice, behavior], () => void persist(), { deep: true });

  function switchPet(id: string) {
    if (id === activePetId.value) return;
    activePetId.value = id;
    const pet = pets.value.find((item) => item.id === id);
    if (pet) voice.value.speaker = pet.voice;
  }

  function updateActivePet(patch: Partial<PetProfile>) {
    const index = pets.value.findIndex((pet) => pet.id === activePetId.value);
    if (index !== -1) pets.value[index] = { ...pets.value[index], ...patch };
  }

  function setActivePetVoice(speaker: string) {
    voice.value.speaker = speaker;
    updateActivePet({ voice: speaker });
  }

  async function refreshCharacterPackages() {
    if (!window.desktopRuntime || packageScanning.value) return characterScan.value;
    packageScanning.value = true;
    try {
      const result = await window.desktopRuntime.scanCharacterPackages();
      if (!result) return characterScan.value;
      characterScan.value = result;
      const localPets = pets.value.filter((pet) => pet.source !== 'character-package');
      const packagePets = result.packages.map(characterPackageToPet);
      pets.value = [...localPets, ...packagePets];
      if (!pets.value.some((pet) => pet.id === activePetId.value)) {
        activePetId.value = pets.value[0]?.id ?? '';
      }
      syncDesktopRuntime();
      return result;
    } finally {
      packageScanning.value = false;
    }
  }

  async function testConnection() {
    connectionState.value = 'testing';
    connectionError.value = null;
    if (!desktopRuntime) {
      const validUrl = safeModelUrlForStorage(llm.value.modelUrl).length > 0;
      connectionState.value = validUrl && llm.value.modelName.length > 2 ? 'success' : 'failed';
      if (connectionState.value === 'failed') connectionError.value = 'model-not-configured';
      return;
    }
    try {
      const result = await desktopRuntime.testModelConnection({ ...llm.value });
      connectionState.value = result.ok ? 'success' : 'failed';
      connectionError.value = result.error ?? null;
    } catch {
      connectionState.value = 'failed';
      connectionError.value = 'network';
    }
  }

  async function refreshApiKeyStatus() {
    if (!desktopRuntime) {
      apiKeyStorageAvailable.value = false;
      apiKeyStored.value = false;
      apiKeyProvider.value = 'session-memory';
      return;
    }
    try {
      const status = await desktopRuntime.getApiKeyStatus();
      apiKeyStorageAvailable.value = status.available;
      apiKeyStored.value = status.stored;
      apiKeyProvider.value = status.provider;
      if (!status.error) return;
      apiKeySaveState.value = 'error';
      apiKeyMessage.value = '已保存的密钥无法读取，请移除后重新保存';
    } catch {
      apiKeyStorageAvailable.value = false;
      apiKeyStored.value = false;
      apiKeySaveState.value = 'error';
      apiKeyMessage.value = '无法连接 Windows 安全存储';
    }
  }

  async function saveApiKey() {
    if (!desktopRuntime || !apiKeyStorageAvailable.value || !apiKeyDraft.value.trim()) return false;
    apiKeySaveState.value = 'saving';
    apiKeyMessage.value = '';
    let result;
    try {
      result = await desktopRuntime.saveApiKey(apiKeyDraft.value);
    } catch {
      apiKeySaveState.value = 'error';
      apiKeyMessage.value = 'API Key 保存失败，请重试';
      return false;
    }
    if (!result.saved) {
      apiKeySaveState.value = 'error';
      apiKeyMessage.value = result.reason === 'unavailable'
        ? 'Windows 安全存储当前不可用'
        : 'API Key 保存失败，请检查后重试';
      return false;
    }
    apiKeyDraft.value = '';
    apiKeyStored.value = result.stored === true;
    apiKeyStorageAvailable.value = result.available !== false;
    apiKeyProvider.value = result.provider ?? apiKeyProvider.value;
    apiKeySaveState.value = 'saved';
    apiKeyMessage.value = 'API Key 已使用当前 Windows 账户加密保存';
    return true;
  }

  async function clearApiKey() {
    if (!desktopRuntime || apiKeySaveState.value === 'saving') return false;
    apiKeySaveState.value = 'saving';
    let cleared = false;
    try {
      cleared = await desktopRuntime.clearApiKey();
    } catch {
      // The state and message below keep the existing key marked as stored.
    }
    apiKeyDraft.value = '';
    apiKeyStored.value = !cleared;
    apiKeySaveState.value = cleared ? 'idle' : 'error';
    apiKeyMessage.value = cleared ? '已移除本机保存的 API Key' : '无法移除 API Key，请重试';
    return cleared;
  }

  async function resetLocalData() {
    if (desktopRuntime) await desktopRuntime.resetConsoleSettings();
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }

  async function initializeDesktopSettings() {
    if (!desktopRuntime) return;
    try {
      const legacyStateExists = localStorage.getItem(STORAGE_KEY) !== null;
      const result = await desktopRuntime.loadConsoleSettings();
      if (result?.settings) {
        applyPersistedSettings(result.settings);
      } else if (legacyStateExists) {
        await desktopRuntime.saveConsoleSettings(settingsSnapshot());
      }
      if (legacyStateExists) localStorage.removeItem(STORAGE_KEY);
      await refreshApiKeyStatus();
      settingsHydrated = true;
      saveState.value = 'saved';
      await refreshCharacterPackages();
      syncDesktopRuntime();
    } catch {
      settingsHydrated = true;
      saveState.value = 'error';
      await refreshCharacterPackages();
      syncDesktopRuntime();
    }
  }

  desktopRuntime?.onSwitchPet((id) => switchPet(id));
  desktopRuntime?.onBehaviorSettingChanged(({ key, value }) => {
    if (key === 'speechBubbleSeconds' && Number.isFinite(value)) {
      behavior.value.speechBubbleSeconds = value;
    }
  });
  if (desktopRuntime) void initializeDesktopSettings();
  else syncDesktopRuntime();

  return {
    activeSection,
    activePetId,
    pets,
    llm,
    voice,
    behavior,
    apiKeyDraft,
    apiKeyStored,
    apiKeyStorageAvailable,
    apiKeyProvider,
    apiKeySaveState,
    apiKeyMessage,
    saveState,
    connectionState,
    connectionError,
    characterScan,
    packageScanning,
    activePet,
    configurationStorageLabel,
    switchPet,
    updateActivePet,
    setActivePetVoice,
    refreshCharacterPackages,
    refreshApiKeyStatus,
    saveApiKey,
    clearApiKey,
    testConnection,
    resetLocalData,
  };
});
