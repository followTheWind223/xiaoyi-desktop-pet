const {
  app,
  BrowserWindow,
  Menu,
  net,
  protocol,
  safeStorage,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const nodeNet = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { scanCharacterPackages } = require('./character-scanner.cjs');

const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const appEntry = path.join(distRoot, 'index.html');
const petEntry = path.join(distRoot, 'pet.html');
const bubbleEntry = path.join(distRoot, 'bubble.html');
let iconPath = path.join(projectRoot, 'src', 'assets', 'pet-reference.png');
let characterPackagesRoot = path.join(projectRoot, 'resources', 'characters');
const PET_WIDTH = 260;
const PET_HEIGHT = 310;
const BUBBLE_WIDTH = 420;
const BUBBLE_COMPACT_HEIGHT = 250;
const BUBBLE_EXPANDED_HEIGHT = 360;
const SETTINGS_VERSION = 1;
const MAX_SETTINGS_BYTES = 256 * 1024;
const MAX_SECRET_BYTES = 16 * 1024;
const MAX_CHAT_HISTORY_BYTES = 2 * 1024 * 1024;
const MAX_CHAT_MESSAGE_CHARS = 1200;
const MAX_CHAT_REPLY_CHARS = 32 * 1024;
const MAX_CHAT_MESSAGES_PER_PET = 80;
const MAX_CHAT_CONTEXT_MESSAGES = 20;
const DEFAULT_HATCH_ANIMATIONS = [
  { id: 'idle', label: '待机', row: 0, mode: 'loop', states: ['idle'] },
  { id: 'running-right', label: '向右跑', row: 1, mode: 'loop', states: ['moving_right'] },
  { id: 'running-left', label: '向左跑', row: 2, mode: 'loop', states: ['moving_left'] },
  { id: 'waving', label: '挥手', row: 3, mode: 'once', states: ['hover', 'input_open'] },
  { id: 'jumping', label: '跳跃', row: 4, mode: 'loop', states: ['dragging'] },
  { id: 'failed', label: '失败', row: 5, mode: 'once', states: ['error'] },
  { id: 'waiting', label: '等待', row: 6, mode: 'loop', states: ['listening', 'transcribing', 'sleeping'] },
  { id: 'running', label: '奔跑 / 工作', row: 7, mode: 'loop', states: ['thinking'] },
  { id: 'review', label: '复盘 / 回答', row: 8, mode: 'loop', states: ['speaking'] },
];

protocol.registerSchemesAsPrivileged([{
  scheme: 'petasset',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let petWindow = null;
let bubbleWindow = null;
let tray = null;
let bubbleHasDraft = false;
let bubbleExpanded = false;
let activePet = null;
let pets = [];
let behavior = { alwaysOnTop: true, edgeSnap: true, movementEnabled: true, idleMotion: true };
let persistedPosition = null;
let petMoveSession = null;
let petWalkSession = null;
let idleWalkTimer = null;
let characterAssetRegistry = new Map();
let settingsWriteQueue = Promise.resolve();
let chatWriteQueue = Promise.resolve();
let conversationsByPet = new Map();
let activeChatRequest = null;
let activeLlmSettings = null;
let runtimeState = {
  uiState: 'idle',
  locked: false,
  clickThrough: false,
  muted: false,
  wakePaused: false,
  alwaysOnTop: true,
};

const allowedUiStates = new Set([
  'idle',
  'hover',
  'input_open',
  'moving_right',
  'moving_left',
  'dragging',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
  'sleeping',
  'error',
]);

function runtimeStatePath() {
  return path.join(app.getPath('userData'), 'pet-window-state.json');
}

function desktopPetDataRoot() {
  return path.join(app.getPath('userData'), 'desktop-pet-data');
}

function consoleSettingsPath() {
  return path.join(desktopPetDataRoot(), 'console-settings.json');
}

function apiKeySecretPath() {
  return path.join(desktopPetDataRoot(), 'model-api-key.bin');
}

function chatHistoryPath() {
  return path.join(desktopPetDataRoot(), 'chat-history.json');
}

function ensureDesktopPetDataRoot() {
  fs.mkdirSync(desktopPetDataRoot(), { recursive: true, mode: 0o700 });
}

function atomicWriteKnownFile(targetPath, data) {
  ensureDesktopPetDataRoot();
  const root = desktopPetDataRoot();
  if (!isPathWithin(root, targetPath)) throw new Error('invalid storage target');
  const stagingPath = path.join(root, `.write-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    fs.writeFileSync(stagingPath, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(stagingPath, targetPath);
  } finally {
    if (isPathWithin(root, stagingPath) && path.basename(stagingPath).startsWith('.write-')) {
      try {
        fs.rmSync(stagingPath, { force: true });
      } catch {
        // Best-effort cleanup for a failed atomic write.
      }
    }
  }
}

function configureRuntimePaths() {
  if (!app.isPackaged) return;
  iconPath = path.join(process.resourcesPath, 'app-icon.png');
  characterPackagesRoot = path.join(app.getPath('userData'), 'characters');
}

function seedBundledCharacterPackages() {
  fs.mkdirSync(characterPackagesRoot, { recursive: true });
  if (!app.isPackaged) return;
  const bundledRoot = path.join(process.resourcesPath, 'characters');
  if (!fs.existsSync(bundledRoot)) return;

  let bundledScan;
  try {
    bundledScan = scanCharacterPackages(bundledRoot);
  } catch {
    return;
  }

  for (const characterPackage of bundledScan.packages) {
    const destination = path.join(characterPackagesRoot, characterPackage.folderName);
    if (fs.existsSync(destination)) continue;
    const source = path.join(bundledRoot, characterPackage.folderName);
    const staging = path.join(
      characterPackagesRoot,
      `.seed-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    try {
      fs.mkdirSync(staging, { recursive: false });
      fs.copyFileSync(path.join(source, 'pet.json'), path.join(staging, 'pet.json'), fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(
        path.join(source, characterPackage.manifest.spritesheetPath),
        path.join(staging, characterPackage.manifest.spritesheetPath),
        fs.constants.COPYFILE_EXCL,
      );
      fs.renameSync(staging, destination);
    } catch {
      if (isPathWithin(characterPackagesRoot, staging) && path.basename(staging).startsWith('.seed-')) {
        try {
          fs.rmSync(staging, { recursive: true, force: true });
        } catch {
          // A failed optional seed must not prevent the app from starting.
        }
      }
    }
  }
}

function scanLocalCharacterPackages() {
  try {
    const result = scanCharacterPackages(characterPackagesRoot);
    const nextRegistry = new Map();
    const packages = result.packages.map((characterPackage) => {
      const assetUrl = `petasset://character/${encodeURIComponent(characterPackage.id)}`;
      const assetPath = path.resolve(
        characterPackagesRoot,
        characterPackage.folderName,
        characterPackage.manifest.spritesheetPath,
      );
      const behaviorConfig = characterPackage.manifest.behavior ?? {};
      const hasCustomAnimations = Boolean(characterPackage.manifest.animations?.length);
      const animations = (hasCustomAnimations ? characterPackage.manifest.animations : DEFAULT_HATCH_ANIMATIONS)
        .filter((animation) => animation.row >= 0 && animation.row < characterPackage.image.atlas.rows)
        .map((animation) => {
          const conventionalState = animation.id === 'running-right'
            ? 'moving_right'
            : animation.id === 'running-left' ? 'moving_left' : null;
          return {
            ...animation,
            states: conventionalState && !animation.states.includes(conventionalState)
              ? [...animation.states, conventionalState]
              : [...animation.states],
          };
        });
      const stateRows = {
        idle: behaviorConfig.idleRows?.[0] ?? 0,
        hover: 3,
        input_open: 3,
        moving_right: behaviorConfig.walkRightRow ?? 1,
        moving_left: behaviorConfig.walkLeftRow ?? 2,
        dragging: behaviorConfig.draggingRow ?? 4,
        listening: 6,
        transcribing: 6,
        thinking: behaviorConfig.thinkingRow ?? 7,
        speaking: behaviorConfig.talkingRow ?? 8,
        sleeping: 6,
        error: 5,
      };
      for (const animationState of Object.keys(stateRows)) {
        stateRows[animationState] = Math.max(0, Math.min(characterPackage.image.atlas.rows - 1, stateRows[animationState]));
      }
      if (hasCustomAnimations) {
        const assignedStates = new Set();
        for (const animation of animations) {
          for (const animationState of animation.states) {
            if (!assignedStates.has(animationState)) {
              stateRows[animationState] = animation.row;
              assignedStates.add(animationState);
            }
          }
        }
      }
      const sprite = {
        assetUrl,
        width: characterPackage.image.width,
        height: characterPackage.image.height,
        columns: characterPackage.image.atlas.columns,
        rows: characterPackage.image.atlas.rows,
        frameWidth: characterPackage.image.atlas.frameWidth,
        frameHeight: characterPackage.image.atlas.frameHeight,
        fps: behaviorConfig.fps ?? 6,
        stateRows,
        animations,
      };
      nextRegistry.set(characterPackage.id, { assetPath, sprite });
      return { ...characterPackage, assetUrl };
    });
    characterAssetRegistry = nextRegistry;
    return { ...result, packages };
  } catch (error) {
    characterAssetRegistry = new Map();
    return {
      rootPath: characterPackagesRoot,
      scannedAt: new Date().toISOString(),
      packages: [],
      issues: [{
        folderName: '',
        code: 'SCAN_FAILED',
        message: sanitizeText(error?.message, 180, '无法读取角色包目录'),
      }],
    };
  }
}

function isPathWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveRegisteredCharacterAsset(packageId) {
  const registered = characterAssetRegistry.get(packageId);
  if (!registered) return null;
  try {
    const rootRealPath = fs.realpathSync(characterPackagesRoot);
    const assetRealPath = fs.realpathSync(registered.assetPath);
    const assetStat = fs.lstatSync(assetRealPath);
    if (!isPathWithin(rootRealPath, assetRealPath) || assetStat.isSymbolicLink() || !assetStat.isFile()) return null;
    return assetRealPath;
  } catch {
    return null;
  }
}

function registerCharacterAssetProtocol() {
  protocol.handle('petasset', async (request) => {
    try {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      const url = new URL(request.url);
      const packageId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (url.hostname !== 'character' || !packageId || packageId.length > 160 || packageId.includes('/')) {
        return new Response('not found', { status: 404 });
      }
      const assetPath = resolveRegisteredCharacterAsset(packageId);
      if (!assetPath) return new Response('not found', { status: 404 });

      const fileResponse = await net.fetch(pathToFileURL(assetPath).toString());
      if (!fileResponse.ok || !fileResponse.body) return new Response('not found', { status: 404 });
      const headers = new Headers(fileResponse.headers);
      headers.set('Content-Type', 'image/webp');
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(fileResponse.body, { status: 200, headers });
    } catch {
      return new Response('asset unavailable', { status: 500 });
    }
  });
}

function loadRuntimeState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(runtimeStatePath(), 'utf8'));
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      persistedPosition = { x: Math.round(parsed.x), y: Math.round(parsed.y) };
    }
    runtimeState.locked = parsed.locked === true;
    runtimeState.muted = parsed.muted === true;
    runtimeState.wakePaused = parsed.wakePaused === true;
    runtimeState.alwaysOnTop = parsed.alwaysOnTop !== false;
  } catch {
    // First launch or invalid local state: use safe defaults.
  }
}

function saveRuntimeState() {
  try {
    const bounds = petWindow?.getBounds();
    const payload = {
      x: bounds?.x ?? persistedPosition?.x,
      y: bounds?.y ?? persistedPosition?.y,
      locked: runtimeState.locked,
      muted: runtimeState.muted,
      wakePaused: runtimeState.wakePaused,
      alwaysOnTop: runtimeState.alwaysOnTop,
    };
    fs.writeFileSync(runtimeStatePath(), JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Position persistence must never break the desktop companion.
  }
}

function sanitizeText(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return [...value.trim()].slice(0, maxLength).join('') || fallback;
}

function sanitizeFiniteNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function sanitizeModelUrl(value) {
  try {
    const url = new URL(value);
    const developmentLoopback = !app.isPackaged
      && process.env.DESKTOP_PET_ALLOW_LOCAL_MODEL === '1'
      && url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    const hasSensitiveQuery = [...url.searchParams.keys()].some((key) => (
      /api[-_]?key|access[-_]?token|secret|password|authorization/i.test(key)
    ));
    if ((url.protocol !== 'https:' && !developmentLoopback) || url.username || url.password || hasSensitiveQuery) return '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function sanitizeLlmSettings(candidate) {
  const llm = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    profileName: sanitizeText(llm.profileName, 80, '默认模型'),
    modelUrl: sanitizeModelUrl(llm.modelUrl),
    modelName: sanitizeText(llm.modelName, 160, 'your-model-name'),
    temperature: sanitizeFiniteNumber(llm.temperature, 0, 1.5, 0.8),
    maxOutputTokens: Math.round(sanitizeFiniteNumber(llm.maxOutputTokens, 100, 4096, 800)),
    timeoutSeconds: Math.round(sanitizeFiniteNumber(llm.timeoutSeconds, 5, 180, 45)),
    streaming: llm.streaming !== false,
    toolCalling: llm.toolCalling === true,
  };
}

function sanitizeStoredPet(candidate) {
  if (!candidate || typeof candidate !== 'object' || candidate.source === 'character-package') return null;
  const id = sanitizeText(candidate.id, 160);
  const name = sanitizeText(candidate.name, 12);
  if (!id || !name) return null;
  return {
    id,
    name,
    subtitle: sanitizeText(candidate.subtitle, 80, '桌面伙伴'),
    personality: sanitizeText(candidate.personality, 500),
    voice: sanitizeText(candidate.voice, 80),
    wakePhrase: sanitizeText(candidate.wakePhrase, 40),
    accent: /^#[0-9a-f]{6}$/i.test(candidate.accent) ? candidate.accent : '#7381d8',
    avatarKind: candidate.avatarKind === 'image' ? 'image' : 'glyph',
    avatarValue: sanitizeText(candidate.avatarValue, 100, '宠'),
    enabled: candidate.enabled !== false,
  };
}

function sanitizeConsoleSettings(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const pets = Array.isArray(candidate.pets)
    ? candidate.pets.slice(0, 20).map(sanitizeStoredPet).filter(Boolean)
    : [];
  if (!pets.length) return null;
  const voice = candidate.voice && typeof candidate.voice === 'object' ? candidate.voice : {};
  const behavior = candidate.behavior && typeof candidate.behavior === 'object' ? candidate.behavior : {};
  const wakeSensitivity = ['low', 'medium', 'high'].includes(voice.wakeSensitivity)
    ? voice.wakeSensitivity
    : 'medium';
  const sanitizeTime = (value, fallback) => (
    typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
  );
  const activePetIdCandidate = sanitizeText(candidate.activePetId, 160);
  return {
    activePetId: activePetIdCandidate || pets[0].id,
    pets,
    llm: sanitizeLlmSettings(candidate.llm),
    voice: {
      inputDevice: sanitizeText(voice.inputDevice, 160, '系统默认麦克风'),
      outputDevice: sanitizeText(voice.outputDevice, 160, '系统默认扬声器'),
      sttModel: sanitizeText(voice.sttModel, 160, 'SenseVoiceSmall INT8'),
      ttsModel: sanitizeText(voice.ttsModel, 160, 'Kokoro multilingual v1.1 INT8'),
      speaker: sanitizeText(voice.speaker, 80, '晓伊 · 温柔女声'),
      speed: sanitizeFiniteNumber(voice.speed, 0.5, 2, 1),
      wakeSensitivity,
      wakeEnabled: voice.wakeEnabled !== false,
      localOnly: voice.localOnly !== false,
    },
    behavior: {
      alwaysOnTop: behavior.alwaysOnTop !== false,
      edgeSnap: behavior.edgeSnap !== false,
      startWithSystem: behavior.startWithSystem === true,
      movementEnabled: behavior.movementEnabled !== false,
      idleMotion: behavior.idleMotion !== false,
      clickThroughShortcut: behavior.clickThroughShortcut !== false,
      quietMode: behavior.quietMode !== false,
      quietStart: sanitizeTime(behavior.quietStart, '23:00'),
      quietEnd: sanitizeTime(behavior.quietEnd, '08:00'),
    },
  };
}

function loadConsoleSettings() {
  try {
    const targetPath = consoleSettingsPath();
    if (!fs.existsSync(targetPath)) return null;
    const stat = fs.statSync(targetPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SETTINGS_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    return sanitizeConsoleSettings(parsed?.settings ?? parsed);
  } catch {
    return null;
  }
}

function saveConsoleSettings(candidate) {
  const settings = sanitizeConsoleSettings(candidate);
  if (!settings) return Promise.resolve({ saved: false, reason: 'invalid' });
  const payload = `${JSON.stringify({
    version: SETTINGS_VERSION,
    updatedAt: new Date().toISOString(),
    settings,
  }, null, 2)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > MAX_SETTINGS_BYTES) {
    return Promise.resolve({ saved: false, reason: 'too-large' });
  }
  settingsWriteQueue = settingsWriteQueue
    .catch(() => undefined)
    .then(() => {
      atomicWriteKnownFile(consoleSettingsPath(), payload);
      return { saved: true };
    })
    .catch(() => ({ saved: false, reason: 'write-failed' }));
  return settingsWriteQueue;
}

async function isSecureStorageAvailable() {
  try {
    if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
      return await safeStorage.isAsyncEncryptionAvailable();
    }
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function encryptSecret(value) {
  if (typeof safeStorage.encryptStringAsync === 'function') {
    return safeStorage.encryptStringAsync(value);
  }
  return safeStorage.encryptString(value);
}

async function decryptSecret(value) {
  if (typeof safeStorage.decryptStringAsync === 'function') {
    return safeStorage.decryptStringAsync(value);
  }
  return { result: safeStorage.decryptString(value), shouldReEncrypt: false };
}

async function secureApiKeyStatus() {
  const available = await isSecureStorageAvailable();
  const provider = process.platform === 'win32' ? 'windows-dpapi' : 'os-keychain';
  if (!available) return { available: false, stored: false, provider };
  try {
    const targetPath = apiKeySecretPath();
    if (!fs.existsSync(targetPath)) return { available: true, stored: false, provider };
    const stat = fs.statSync(targetPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SECRET_BYTES) {
      return { available: true, stored: false, provider, error: 'unreadable' };
    }
    const encrypted = fs.readFileSync(targetPath);
    const decrypted = await decryptSecret(encrypted);
    if (!decrypted.result) return { available: true, stored: false, provider, error: 'unreadable' };
    if (decrypted.shouldReEncrypt) {
      atomicWriteKnownFile(targetPath, await encryptSecret(decrypted.result));
    }
    return { available: true, stored: true, provider };
  } catch {
    return { available: true, stored: false, provider, error: 'unreadable' };
  }
}

async function saveSecureApiKey(candidate) {
  if (typeof candidate !== 'string') return { saved: false, reason: 'invalid' };
  const apiKey = candidate.trim();
  if (!apiKey || apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
    return { saved: false, reason: 'invalid' };
  }
  if (!(await isSecureStorageAvailable())) return { saved: false, reason: 'unavailable' };
  try {
    atomicWriteKnownFile(apiKeySecretPath(), await encryptSecret(apiKey));
    return { saved: true, ...(await secureApiKeyStatus()) };
  } catch {
    return { saved: false, reason: 'write-failed' };
  }
}

async function clearSecureApiKey() {
  try {
    const targetPath = apiKeySecretPath();
    if (!isPathWithin(desktopPetDataRoot(), targetPath)) return false;
    fs.rmSync(targetPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

class ChatRequestError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ChatRequestError';
    this.code = code;
  }
}

function sanitizeChatContent(value, maxLength) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .trim();
  return [...normalized].slice(0, maxLength).join('');
}

function sanitizeChatMessage(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const role = candidate.role === 'user' || candidate.role === 'assistant' ? candidate.role : null;
  const maxLength = role === 'user' ? MAX_CHAT_MESSAGE_CHARS : MAX_CHAT_REPLY_CHARS;
  const content = role ? sanitizeChatContent(candidate.content, maxLength) : '';
  if (!role || !content) return null;
  const createdAt = typeof candidate.createdAt === 'string' && !Number.isNaN(Date.parse(candidate.createdAt))
    ? candidate.createdAt
    : new Date().toISOString();
  return {
    id: sanitizeText(candidate.id, 80, crypto.randomUUID()),
    role,
    content,
    createdAt,
  };
}

function loadChatHistory() {
  conversationsByPet = new Map();
  try {
    const targetPath = chatHistoryPath();
    if (!fs.existsSync(targetPath)) return;
    const stat = fs.statSync(targetPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CHAT_HISTORY_BYTES) return;
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    if (!Array.isArray(parsed?.conversations)) return;
    for (const item of parsed.conversations.slice(0, 20)) {
      const petId = sanitizeText(item?.petId, 160);
      if (!petId || !Array.isArray(item.messages)) continue;
      const messages = item.messages
        .slice(-MAX_CHAT_MESSAGES_PER_PET)
        .map(sanitizeChatMessage)
        .filter(Boolean);
      if (messages.length) conversationsByPet.set(petId, messages);
    }
  } catch {
    conversationsByPet = new Map();
  }
}

function serializeChatHistory() {
  const buildPayload = () => `${JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    conversations: [...conversationsByPet.entries()].map(([petId, messages]) => ({ petId, messages })),
  }, null, 2)}\n`;
  let payload = buildPayload();
  while (Buffer.byteLength(payload, 'utf8') > MAX_CHAT_HISTORY_BYTES) {
    let oldestPetId = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [petId, messages] of conversationsByPet) {
      const timestamp = Date.parse(messages[0]?.createdAt ?? '') || 0;
      if (messages.length && timestamp < oldestTime) {
        oldestPetId = petId;
        oldestTime = timestamp;
      }
    }
    if (!oldestPetId) break;
    const messages = conversationsByPet.get(oldestPetId);
    messages.shift();
    if (!messages.length) conversationsByPet.delete(oldestPetId);
    payload = buildPayload();
  }
  return payload;
}

function saveChatHistory() {
  const payload = serializeChatHistory();
  chatWriteQueue = chatWriteQueue
    .catch(() => undefined)
    .then(() => atomicWriteKnownFile(chatHistoryPath(), payload))
    .catch(() => undefined);
  return chatWriteQueue;
}

function messagesForPet(petId) {
  return conversationsByPet.get(petId) ?? [];
}

function appendChatMessage(petId, message) {
  const messages = [...messagesForPet(petId), message].slice(-MAX_CHAT_MESSAGES_PER_PET);
  conversationsByPet.set(petId, messages);
  void saveChatHistory();
}

function isBlockedIpAddress(address) {
  const version = nodeNet.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) return isBlockedIpAddress(normalized.slice(7));
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized);
  }
  return true;
}

function chatEndpointForSettings(llm) {
  const sanitized = sanitizeModelUrl(llm?.modelUrl);
  const modelName = sanitizeText(llm?.modelName, 160);
  if (!sanitized || !modelName || modelName === 'your-model-name' || sanitized.includes('api.example.com')) {
    throw new ChatRequestError('model-not-configured');
  }
  const url = new URL(sanitized);
  const pathName = url.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/i.test(pathName)) {
    url.pathname = pathName && pathName !== '/'
      ? `${pathName}/chat/completions`
      : '/v1/chat/completions';
  }
  return url;
}

async function assertSafeRemoteEndpoint(url) {
  const host = url.hostname.toLowerCase();
  const developmentLoopback = !app.isPackaged
    && process.env.DESKTOP_PET_ALLOW_LOCAL_MODEL === '1'
    && url.protocol === 'http:'
    && (host === '127.0.0.1' || host === '[::1]');
  if (developmentLoopback) return;
  if (host === 'localhost' || host.endsWith('.localhost')) throw new ChatRequestError('unsafe-endpoint');
  if (nodeNet.isIP(host) && isBlockedIpAddress(host)) throw new ChatRequestError('unsafe-endpoint');
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ChatRequestError('network');
  }
  if (!addresses.length || addresses.some((item) => isBlockedIpAddress(item.address))) {
    throw new ChatRequestError('unsafe-endpoint');
  }
}

async function readSecureApiKey() {
  if (!(await isSecureStorageAvailable())) throw new ChatRequestError('secure-storage-unavailable');
  try {
    const targetPath = apiKeySecretPath();
    if (!fs.existsSync(targetPath)) throw new ChatRequestError('api-key-missing');
    const stat = fs.statSync(targetPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SECRET_BYTES) {
      throw new ChatRequestError('api-key-unreadable');
    }
    const decrypted = await decryptSecret(fs.readFileSync(targetPath));
    const apiKey = typeof decrypted.result === 'string' ? decrypted.result.trim() : '';
    if (!apiKey || apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
      throw new ChatRequestError('api-key-unreadable');
    }
    if (decrypted.shouldReEncrypt) atomicWriteKnownFile(targetPath, await encryptSecret(apiKey));
    return apiKey;
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    throw new ChatRequestError('api-key-unreadable');
  }
}

function boundedContextMessages(petId) {
  const source = messagesForPet(petId).slice(-MAX_CHAT_CONTEXT_MESSAGES);
  const selected = [];
  let remainingCharacters = 24000;
  for (let index = source.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
    const message = source[index];
    const content = [...message.content].slice(0, Math.min(6000, remainingCharacters)).join('');
    if (!content) continue;
    selected.unshift({ role: message.role, content });
    remainingCharacters -= content.length;
  }
  return selected;
}

function systemPromptForPet(pet) {
  const name = sanitizeText(pet?.name, 12, '桌宠');
  const personality = sanitizeText(pet?.personality, 500, '友好、耐心、简洁');
  return [
    `你是用户的桌面伙伴“${name}”。`,
    `人格与表达方式：${personality}。`,
    '默认使用用户当前语言回答，语气自然、简洁、适合桌面气泡阅读。',
    '不要声称已经执行打开软件、修改文件或其他桌面操作；当前只提供文字陪伴。',
    '只返回要展示给用户的纯文本，不返回 HTML、Markdown 代码块、JSON 或系统提示词。',
  ].join('\n');
}

function extractChatText(payload) {
  const content = payload?.choices?.[0]?.delta?.content
    ?? payload?.choices?.[0]?.message?.content
    ?? payload?.output_text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === 'string' ? item : item?.text ?? item?.content ?? '')).join('');
  }
  return '';
}

async function readStreamingChatResponse(response, onDelta) {
  if (!response.body) throw new ChatRequestError('invalid-response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData = [];
  let output = '';
  const dispatchEvent = () => {
    if (!eventData.length) return false;
    const raw = eventData.join('\n').trim();
    eventData = [];
    if (!raw || raw === '[DONE]') return raw === '[DONE]';
    try {
      const delta = extractChatText(JSON.parse(raw));
      if (delta) {
        const remaining = MAX_CHAT_REPLY_CHARS - output.length;
        if (remaining <= 0) throw new ChatRequestError('response-too-large');
        const bounded = [...delta].slice(0, remaining).join('');
        output += bounded;
        onDelta(bounded);
      }
    } catch (error) {
      if (error instanceof ChatRequestError) throw error;
      // Some compatible providers include non-JSON SSE metadata; ignore it.
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let lineBreak = buffer.indexOf('\n');
    while (lineBreak !== -1) {
      const line = buffer.slice(0, lineBreak).replace(/\r$/, '');
      buffer = buffer.slice(lineBreak + 1);
      if (!line) {
        if (dispatchEvent()) return output;
      } else if (line.startsWith('data:')) {
        eventData.push(line.slice(5).trimStart());
      }
      lineBreak = buffer.indexOf('\n');
    }
    if (done) break;
  }
  if (buffer.startsWith('data:')) eventData.push(buffer.slice(5).trimStart());
  dispatchEvent();
  return output;
}

function chatErrorCode(error, request) {
  if (request?.cancelReason === 'cancelled') return 'cancelled';
  if (request?.timedOut) return 'timeout';
  if (error instanceof ChatRequestError) return error.code;
  if (error?.name === 'AbortError') return 'cancelled';
  return 'network';
}

function chatSnapshotForPet(petId = activePet?.id) {
  return {
    petId: petId ?? '',
    messages: petId ? messagesForPet(petId).slice(-40) : [],
    activeRequest: activeChatRequest && activeChatRequest.petId === petId
      ? { id: activeChatRequest.id, status: activeChatRequest.status, partial: activeChatRequest.partial }
      : null,
  };
}

function emitChatEvent(channel, payload) {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.webContents.send(channel, payload);
}

async function requestModelCompletion({ llm, endpoint, apiKey, messages, signal, onDelta }) {
  const response = await net.fetch(endpoint.toString(), {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      Accept: llm.streaming ? 'text/event-stream, application/json' : 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: llm.modelName,
      messages,
      temperature: llm.temperature,
      max_tokens: llm.maxOutputTokens,
      stream: llm.streaming,
    }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ChatRequestError('authentication');
    if (response.status === 404) throw new ChatRequestError('model-or-endpoint-not-found');
    if (response.status === 429) throw new ChatRequestError('rate-limited');
    if (response.status >= 500) throw new ChatRequestError('provider-unavailable');
    throw new ChatRequestError('request-rejected');
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (llm.streaming && contentType.includes('text/event-stream')) {
    return readStreamingChatResponse(response, onDelta);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ChatRequestError('invalid-response');
  }
  const output = [...extractChatText(payload)].slice(0, MAX_CHAT_REPLY_CHARS).join('');
  if (output) onDelta(output);
  return output;
}

async function runChatRequest(request, llm, endpoint, apiKey) {
  const timer = setTimeout(() => {
    request.timedOut = true;
    request.controller.abort();
  }, llm.timeoutSeconds * 1000);
  timer.unref?.();
  try {
    const messages = [
      { role: 'system', content: systemPromptForPet(request.pet) },
      ...boundedContextMessages(request.petId),
    ];
    const output = await requestModelCompletion({
      llm,
      endpoint,
      apiKey,
      messages,
      signal: request.controller.signal,
      onDelta: (delta) => {
        if (!delta || activeChatRequest !== request) return;
        request.status = 'speaking';
        request.partial += delta;
        if (runtimeState.uiState !== 'speaking') setUiState('speaking');
        emitChatEvent('chat:chunk', { requestId: request.id, delta });
      },
    });
    const reply = sanitizeText(output || request.partial, MAX_CHAT_REPLY_CHARS);
    if (!reply) throw new ChatRequestError('empty-response');
    appendChatMessage(request.petId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: reply,
      createdAt: new Date().toISOString(),
    });
    if (activeChatRequest === request) activeChatRequest = null;
    emitChatEvent('chat:complete', { requestId: request.id, message: messagesForPet(request.petId).at(-1) });
    if (runtimeState.uiState === 'thinking' || runtimeState.uiState === 'speaking') setUiState('idle');
  } catch (error) {
    const code = chatErrorCode(error, request);
    let stoppedMessage;
    if (code === 'cancelled') {
      const partial = sanitizeText(request.partial, MAX_CHAT_REPLY_CHARS);
      if (partial) {
        stoppedMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: partial,
          createdAt: new Date().toISOString(),
        };
        appendChatMessage(request.petId, stoppedMessage);
      }
    }
    if (activeChatRequest === request) activeChatRequest = null;
    emitChatEvent('chat:error', { requestId: request.id, code, ...(stoppedMessage ? { message: stoppedMessage } : {}) });
    if (code === 'cancelled') {
      if (runtimeState.uiState === 'thinking' || runtimeState.uiState === 'speaking') setUiState('input_open');
    } else {
      setUiState('error');
      const errorTimer = setTimeout(() => {
        if (runtimeState.uiState === 'error') setUiState('input_open');
      }, 1800);
      errorTimer.unref?.();
    }
  } finally {
    clearTimeout(timer);
  }
}

async function startChatMessage(candidate) {
  if (activeChatRequest) return { started: false, error: 'busy' };
  const message = sanitizeChatContent(candidate, MAX_CHAT_MESSAGE_CHARS);
  if (!message) return { started: false, error: 'invalid-message' };
  if (!activePet?.id) return { started: false, error: 'pet-unavailable' };
  stopPetWalk();

  const request = {
    id: crypto.randomUUID(),
    petId: activePet.id,
    pet: { ...activePet },
    controller: new AbortController(),
    status: 'thinking',
    partial: '',
    timedOut: false,
    cancelReason: null,
  };
  activeChatRequest = request;
  try {
    const llm = sanitizeLlmSettings(activeLlmSettings ?? loadConsoleSettings()?.llm);
    const endpoint = chatEndpointForSettings(llm);
    await assertSafeRemoteEndpoint(endpoint);
    const apiKey = await readSecureApiKey();
    appendChatMessage(request.petId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    });
    setUiState('thinking');
    void runChatRequest(request, llm, endpoint, apiKey);
    return { started: true, requestId: request.id };
  } catch (error) {
    if (activeChatRequest === request) activeChatRequest = null;
    const code = chatErrorCode(error, request);
    if (runtimeState.uiState === 'thinking') setUiState('input_open');
    return { started: false, error: code };
  }
}

function stopActiveChat() {
  if (!activeChatRequest) return false;
  activeChatRequest.cancelReason = 'cancelled';
  activeChatRequest.controller.abort();
  return true;
}

async function testModelConnection(candidate) {
  const llm = sanitizeLlmSettings(candidate);
  let request;
  try {
    const endpoint = chatEndpointForSettings(llm);
    await assertSafeRemoteEndpoint(endpoint);
    const apiKey = await readSecureApiKey();
    request = { controller: new AbortController(), timedOut: false, cancelReason: null };
    const timer = setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, Math.min(llm.timeoutSeconds, 30) * 1000);
    timer.unref?.();
    try {
      await requestModelCompletion({
        llm: { ...llm, streaming: false, maxOutputTokens: 8, temperature: 0 },
        endpoint,
        apiKey,
        messages: [{ role: 'user', content: '请只回复 OK。' }],
        signal: request.controller.signal,
        onDelta: () => undefined,
      });
    } finally {
      clearTimeout(timer);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: chatErrorCode(error, request) };
  }
}

async function resetConsoleSettings() {
  stopActiveChat();
  const targets = [consoleSettingsPath(), apiKeySecretPath(), chatHistoryPath()];
  try {
    for (const targetPath of targets) {
      if (!isPathWithin(desktopPetDataRoot(), targetPath)) return false;
      fs.rmSync(targetPath, { force: true });
    }
    try {
      fs.rmdirSync(desktopPetDataRoot());
    } catch {
      // Keep a non-empty data directory; only the two known files are reset.
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizePetProfile(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = sanitizeText(candidate.id, 160);
  const name = sanitizeText(candidate.name, 12);
  if (!id || !name) return null;
  const packageId = candidate.source === 'character-package'
    ? sanitizeText(candidate.packageId, 160)
    : '';
  const registeredPackage = packageId ? characterAssetRegistry.get(packageId) : null;
  if (candidate.source === 'character-package' && (!registeredPackage || id !== packageId)) return null;
  return {
    id,
    name,
    subtitle: sanitizeText(candidate.subtitle, 80, '桌面伙伴'),
    personality: sanitizeText(candidate.personality, 500),
    voice: sanitizeText(candidate.voice, 80),
    wakePhrase: sanitizeText(candidate.wakePhrase, 40),
    accent: /^#[0-9a-f]{6}$/i.test(candidate.accent) ? candidate.accent : '#7381d8',
    avatarKind: registeredPackage ? 'spritesheet' : candidate.avatarKind === 'glyph' ? 'glyph' : 'image',
    avatarValue: sanitizeText(candidate.avatarValue, 100),
    enabled: candidate.enabled !== false,
    ...(registeredPackage ? {
      source: 'character-package',
      packageId,
      sprite: registeredPackage.sprite,
    } : {}),
  };
}

function isKnownSender(event) {
  const sender = event.sender;
  return [mainWindow, petWindow, bubbleWindow].some((window) => window && window.webContents === sender);
}

function isSender(event, window) {
  return Boolean(window && event.sender === window.webContents);
}

function configureNavigation(window, entry, allowExternalHttps = false) {
  const allowedUrl = pathToFileURL(entry).toString();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowExternalHttps && url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function safeDesktopSnapshot() {
  return {
    activePet,
    runtime: {
      ...runtimeState,
      visible: Boolean(petWindow?.isVisible()),
    },
  };
}

function broadcastProfile() {
  if (!activePet) return;
  petWindow?.webContents.send('runtime:pet-profile-changed', activePet);
  bubbleWindow?.webContents.send('runtime:pet-profile-changed', activePet);
}

function broadcastState() {
  const state = safeDesktopSnapshot().runtime;
  petWindow?.webContents.send('runtime:pet-state-changed', state);
  bubbleWindow?.webContents.send('runtime:pet-state-changed', state);
  void rebuildTrayMenu();
}

function setUiState(next) {
  if (!allowedUiStates.has(next)) return false;
  const walkingState = petWalkSession?.direction === 'right' ? 'moving_right' : 'moving_left';
  if (petWalkSession && next !== walkingState) stopPetWalk(false);
  runtimeState.uiState = next;
  broadcastState();
  if (next === 'idle') scheduleIdleWalk();
  else clearIdleWalkTimer();
  return true;
}

function clampPetPosition(x, y) {
  const targetDisplay = screen.getDisplayNearestPoint({
    x: Math.round(x + PET_WIDTH / 2),
    y: Math.round(y + PET_HEIGHT / 2),
  });
  const area = targetDisplay.workArea;
  let nextX = Math.max(area.x, Math.min(area.x + area.width - PET_WIDTH, Math.round(x)));
  let nextY = Math.max(area.y, Math.min(area.y + area.height - PET_HEIGHT, Math.round(y)));
  if (behavior.edgeSnap) {
    const gap = 18;
    if (Math.abs(nextX - area.x) <= gap) nextX = area.x;
    if (Math.abs(nextY - area.y) <= gap) nextY = area.y;
    if (Math.abs(nextX + PET_WIDTH - (area.x + area.width)) <= gap) nextX = area.x + area.width - PET_WIDTH;
    if (Math.abs(nextY + PET_HEIGHT - (area.y + area.height)) <= gap) nextY = area.y + area.height - PET_HEIGHT;
  }
  return { x: nextX, y: nextY };
}

function setPetWindowPosition(x, y) {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const next = clampPetPosition(x, y);
  if (petWindow.isFullScreen()) petWindow.setFullScreen(false);
  if (petWindow.isMaximized()) petWindow.unmaximize();
  petWindow.setBounds({ x: next.x, y: next.y, width: PET_WIDTH, height: PET_HEIGHT }, false);
  return next;
}

function clearIdleWalkTimer() {
  if (idleWalkTimer) clearTimeout(idleWalkTimer);
  idleWalkTimer = null;
}

function isPetWalking() {
  return runtimeState.uiState === 'moving_right' || runtimeState.uiState === 'moving_left';
}

function stopPetWalk(restoreIdle = true) {
  clearIdleWalkTimer();
  if (petWalkSession?.timer) clearInterval(petWalkSession.timer);
  const wasWalking = Boolean(petWalkSession) || isPetWalking();
  petWalkSession = null;
  if (wasWalking) saveRuntimeState();
  if (restoreIdle && isPetWalking()) setUiState('idle');
  return wasWalking;
}

function canStartPetWalk(automatic) {
  return Boolean(
    petWindow
    && !petWindow.isDestroyed()
    && petWindow.isVisible()
    && runtimeState.uiState === 'idle'
    && !runtimeState.locked
    && !runtimeState.clickThrough
    && !petMoveSession
    && !activeChatRequest
    && !bubbleWindow?.isVisible()
    && behavior.movementEnabled !== false
    && (!automatic || behavior.idleMotion !== false),
  );
}

function petWalkBlockedReason() {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return 'unavailable';
  if (runtimeState.locked) return 'locked';
  if (runtimeState.clickThrough) return 'click-through';
  if (behavior.movementEnabled === false) return 'movement-disabled';
  if (runtimeState.uiState !== 'idle') return 'busy';
  if (petMoveSession) return 'dragging';
  if (activeChatRequest) return 'chat-active';
  if (bubbleWindow?.isVisible()) return 'bubble-open';
  return 'busy';
}

function startPetWalk(direction, options = {}) {
  const normalizedDirection = direction === 'left' ? 'left' : direction === 'right' ? 'right' : null;
  const automatic = options.automatic === true;
  if (!normalizedDirection) return { started: false, reason: 'invalid' };
  if (!canStartPetWalk(automatic)) return { started: false, reason: petWalkBlockedReason() };

  const bounds = petWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const available = normalizedDirection === 'right'
    ? area.x + area.width - PET_WIDTH - bounds.x
    : bounds.x - area.x;
  const requestedDistance = Number.isFinite(options.distance)
    ? Math.max(16, Math.min(160, Number(options.distance)))
    : 56 + Math.round(Math.random() * 64);
  const distance = Math.min(requestedDistance, Math.max(0, available));
  if (distance < 12) return { started: false, reason: 'boundary' };

  const speed = Number.isFinite(options.speed)
    ? Math.max(20, Math.min(90, Number(options.speed)))
    : automatic ? 30 : 54;
  const state = normalizedDirection === 'right' ? 'moving_right' : 'moving_left';
  const startedAt = Date.now();
  const durationMs = Math.max(280, (distance / speed) * 1000);
  const startX = bounds.x;
  const startY = bounds.y;
  clearIdleWalkTimer();
  petWalkSession = {
    direction: normalizedDirection,
    state,
    timer: null,
  };
  setUiState(state);

  const finish = () => {
    if (!petWalkSession || petWalkSession.state !== state) return;
    const targetX = startX + (normalizedDirection === 'right' ? distance : -distance);
    setPetWindowPosition(targetX, startY);
    if (petWalkSession.timer) clearInterval(petWalkSession.timer);
    petWalkSession = null;
    saveRuntimeState();
    if (runtimeState.uiState === state) setUiState('idle');
  };

  petWalkSession.timer = setInterval(() => {
    if (!petWalkSession || petWalkSession.state !== state || runtimeState.uiState !== state) {
      stopPetWalk(false);
      return;
    }
    if (runtimeState.locked || runtimeState.clickThrough || behavior.movementEnabled === false || activeChatRequest || bubbleWindow?.isVisible()) {
      stopPetWalk();
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
    const nextX = startX + (normalizedDirection === 'right' ? distance * progress : -distance * progress);
    setPetWindowPosition(nextX, startY);
    if (progress >= 1) finish();
  }, 40);
  petWalkSession.timer.unref?.();
  return { started: true, direction: normalizedDirection, distance: Math.round(distance) };
}

function scheduleIdleWalk(delayMs) {
  clearIdleWalkTimer();
  if (behavior.movementEnabled === false || behavior.idleMotion === false || runtimeState.uiState !== 'idle') return;
  const delay = Number.isFinite(delayMs) ? Number(delayMs) : 12000 + Math.round(Math.random() * 12000);
  idleWalkTimer = setTimeout(() => {
    idleWalkTimer = null;
    if (!canStartPetWalk(true)) {
      scheduleIdleWalk(6000);
      return;
    }
    const bounds = petWindow.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const leftSpace = bounds.x - area.x;
    const rightSpace = area.x + area.width - PET_WIDTH - bounds.x;
    let direction = Math.random() < 0.5 ? 'left' : 'right';
    if (direction === 'left' && leftSpace < 24) direction = 'right';
    if (direction === 'right' && rightSpace < 24) direction = 'left';
    const result = startPetWalk(direction, { automatic: true });
    if (!result.started) scheduleIdleWalk(6000);
  }, Math.max(1000, delay));
  idleWalkTimer.unref?.();
}

function defaultPetPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - PET_WIDTH - 28,
    y: area.y + area.height - PET_HEIGHT - 24,
  };
}

function positionBubbleWindow() {
  if (!petWindow || !bubbleWindow) return;
  const petBounds = petWindow.getBounds();
  const bubbleBounds = bubbleWindow.getBounds();
  const display = screen.getDisplayMatching(petBounds);
  const area = display.workArea;
  let x = Math.round(petBounds.x + petBounds.width / 2 - BUBBLE_WIDTH / 2);
  let y = petBounds.y - bubbleBounds.height + 16;
  if (y < area.y + 8) y = petBounds.y + petBounds.height - 22;
  x = Math.max(area.x + 8, Math.min(area.x + area.width - BUBBLE_WIDTH - 8, x));
  y = Math.max(area.y + 8, Math.min(area.y + area.height - bubbleBounds.height - 8, y));
  bubbleWindow.setBounds({ x, y, width: BUBBLE_WIDTH, height: bubbleBounds.height }, false);
}

function setBubbleExpanded(expanded) {
  bubbleExpanded = expanded === true;
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return true;
  const bounds = bubbleWindow.getBounds();
  const height = bubbleExpanded ? BUBBLE_EXPANDED_HEIGHT : BUBBLE_COMPACT_HEIGHT;
  bubbleWindow.setBounds({ x: bounds.x, y: bounds.y, width: BUBBLE_WIDTH, height }, false);
  positionBubbleWindow();
  return true;
}

function createSettingsWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    title: '桌宠控制台',
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f2ed',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  configureNavigation(mainWindow, appEntry, true);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(appEntry);
  return mainWindow;
}

function showSettingsWindow() {
  const window = createSettingsWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const initial = clampPetPosition(
    persistedPosition?.x ?? defaultPetPosition().x,
    persistedPosition?.y ?? defaultPetPosition().y,
  );
  petWindow = new BrowserWindow({
    title: '桌宠',
    x: initial.x,
    y: initial.y,
    width: PET_WIDTH,
    height: PET_HEIGHT,
    minWidth: PET_WIDTH,
    minHeight: PET_HEIGHT,
    maxWidth: PET_WIDTH,
    maxHeight: PET_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: false,
    alwaysOnTop: runtimeState.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  configureNavigation(petWindow, petEntry);
  petWindow.setAlwaysOnTop(runtimeState.alwaysOnTop, 'floating');
  petWindow.once('ready-to-show', () => {
    petWindow?.showInactive();
    if (runtimeState.clickThrough) petWindow?.setIgnoreMouseEvents(true, { forward: false });
    broadcastProfile();
    broadcastState();
  });
  petWindow.on('move', positionBubbleWindow);
  petWindow.on('closed', () => {
    petWindow = null;
  });
  void petWindow.loadFile(petEntry);
  return petWindow;
}

function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return bubbleWindow;
  bubbleWindow = new BrowserWindow({
    title: '桌宠对话',
    width: BUBBLE_WIDTH,
    height: bubbleExpanded ? BUBBLE_EXPANDED_HEIGHT : BUBBLE_COMPACT_HEIGHT,
    minWidth: BUBBLE_WIDTH,
    minHeight: BUBBLE_COMPACT_HEIGHT,
    maxWidth: BUBBLE_WIDTH,
    maxHeight: BUBBLE_EXPANDED_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  configureNavigation(bubbleWindow, bubbleEntry);
  bubbleWindow.on('blur', () => {
    if (!bubbleHasDraft && runtimeState.uiState === 'input_open') hideBubbleWindow();
  });
  bubbleWindow.on('closed', () => {
    bubbleWindow = null;
  });
  void bubbleWindow.loadFile(bubbleEntry);
  return bubbleWindow;
}

function showPetWindow() {
  const window = createPetWindow();
  window.showInactive();
  broadcastState();
  if (runtimeState.uiState === 'idle') scheduleIdleWalk();
  return true;
}

function hidePetWindow() {
  stopPetWalk();
  hideBubbleWindow();
  petWindow?.hide();
  clearIdleWalkTimer();
  broadcastState();
  return true;
}

function setClickThrough(enabled) {
  runtimeState.clickThrough = Boolean(enabled);
  if (runtimeState.clickThrough) {
    stopPetWalk();
    hideBubbleWindow();
    clearIdleWalkTimer();
    petWindow?.setIgnoreMouseEvents(true, { forward: false });
  } else {
    petWindow?.setIgnoreMouseEvents(false);
    showPetWindow();
  }
  broadcastState();
  return true;
}

function showBubbleWindow() {
  stopPetWalk();
  setClickThrough(false);
  showPetWindow();
  const window = createBubbleWindow();
  positionBubbleWindow();
  if (!activeChatRequest) setUiState('input_open');
  window.show();
  window.focus();
  window.webContents.send('pet-bubble:focus-input');
  window.webContents.send('chat:snapshot', chatSnapshotForPet());
  return true;
}

function hideBubbleWindow() {
  bubbleWindow?.hide();
  bubbleHasDraft = false;
  if (!activeChatRequest && runtimeState.uiState !== 'dragging') setUiState('idle');
  return true;
}

function activatePetFromMain(id) {
  const next = pets.find((pet) => pet.id === id);
  if (!next || next.id === activePet?.id) return;
  stopActiveChat();
  stopPetWalk();
  activePet = next;
  broadcastProfile();
  mainWindow?.webContents.send('runtime:switch-pet', id);
  void rebuildTrayMenu();
}

function previewPetAnimationFromMain(animationId) {
  if (typeof animationId !== 'string' || !activePet?.sprite) return false;
  const animation = activePet.sprite.animations.find((item) => item.id === animationId);
  if (!animation) return false;
  stopPetWalk();
  showPetWindow();
  petWindow?.webContents.send('runtime:preview-pet-animation', animation);
  return true;
}

function showPetContextMenu() {
  if (!petWindow) return;
  const isBusy = runtimeState.uiState === 'thinking' || runtimeState.uiState === 'speaking';
  const switchItems = pets.map((pet) => ({
    label: pet.name,
    type: 'radio',
    checked: pet.id === activePet?.id,
    click: () => activatePetFromMain(pet.id),
  }));
  const animationItems = activePet?.sprite?.animations?.map((animation) => ({
    label: animation.label,
    click: () => previewPetAnimationFromMain(animation.id),
  })) ?? [];
  const menu = Menu.buildFromTemplate([
    { label: '输入文字', accelerator: 'Ctrl+Alt+Enter', click: showBubbleWindow },
    { label: '开始语音对话（待接入）', enabled: false },
    {
      label: '停止当前回答',
      enabled: isBusy,
      click: () => {
        stopActiveChat();
      },
    },
    {
      label: behavior.movementEnabled === false ? '移动一下（已关闭）' : '移动一下',
      enabled: behavior.movementEnabled !== false && !runtimeState.locked && !isBusy,
      submenu: [
        { label: '向左走', click: () => startPetWalk('left', { distance: 72, speed: 54 }) },
        { label: '向右走', click: () => startPetWalk('right', { distance: 72, speed: 54 }) },
      ],
    },
    {
      label: '展示动作',
      enabled: !isBusy && animationItems.length > 0,
      submenu: animationItems.length ? animationItems : [{ label: '当前角色没有可用动作', enabled: false }],
    },
    { type: 'separator' },
    { label: '切换桌宠', submenu: switchItems.length ? switchItems : [{ label: '暂无桌宠', enabled: false }] },
    {
      label: runtimeState.wakePaused ? '恢复语音唤醒' : '暂停语音唤醒',
      click: () => {
        runtimeState.wakePaused = !runtimeState.wakePaused;
        saveRuntimeState();
        broadcastState();
      },
    },
    {
      label: runtimeState.muted ? '恢复声音' : '静音',
      click: () => {
        runtimeState.muted = !runtimeState.muted;
        saveRuntimeState();
        broadcastState();
      },
    },
    { type: 'separator' },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: runtimeState.alwaysOnTop,
      click: (item) => {
        runtimeState.alwaysOnTop = item.checked;
        petWindow?.setAlwaysOnTop(item.checked, 'floating');
        saveRuntimeState();
        broadcastState();
      },
    },
    {
      label: runtimeState.locked ? '解锁位置' : '锁定位置',
      click: () => {
        runtimeState.locked = !runtimeState.locked;
        if (runtimeState.locked) stopPetWalk();
        saveRuntimeState();
        broadcastState();
      },
    },
    {
      label: runtimeState.clickThrough ? '恢复桌宠交互' : '临时启用点击穿透',
      accelerator: 'Ctrl+Alt+P',
      click: () => setClickThrough(!runtimeState.clickThrough),
    },
    { type: 'separator' },
    { label: '打开设置', click: showSettingsWindow },
    { label: '隐藏桌宠', click: hidePetWindow },
    { label: '退出应用', click: () => app.quit() },
  ]);
  menu.popup({ window: petWindow });
}

async function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: petWindow?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => (petWindow?.isVisible() ? hidePetWindow() : showPetWindow()) },
    { label: '输入文字', click: showBubbleWindow },
    { label: '打开设置', click: showSettingsWindow },
    { type: 'separator' },
    {
      label: runtimeState.clickThrough ? '恢复桌宠交互' : '启用点击穿透',
      click: () => setClickThrough(!runtimeState.clickThrough),
    },
    { type: 'separator' },
    { label: '退出应用', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(activePet ? `${activePet.name} · 桌面陪伴中` : '桌宠');
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.on('click', showPetWindow);
  void rebuildTrayMenu();
}

function registerIpc() {
  ipcMain.handle('settings:load', (event) => {
    if (!isSender(event, mainWindow)) return null;
    return {
      settings: loadConsoleSettings(),
      storage: {
        kind: 'user-data-file',
        persistent: true,
      },
    };
  });
  ipcMain.handle('settings:save', (event, payload) => (
    isSender(event, mainWindow) ? saveConsoleSettings(payload) : { saved: false, reason: 'forbidden' }
  ));
  ipcMain.handle('settings:api-key-status', (event) => (
    isSender(event, mainWindow)
      ? secureApiKeyStatus()
      : { available: false, stored: false, provider: 'forbidden' }
  ));
  ipcMain.handle('settings:save-api-key', (event, apiKey) => (
    isSender(event, mainWindow) ? saveSecureApiKey(apiKey) : { saved: false, reason: 'forbidden' }
  ));
  ipcMain.handle('settings:clear-api-key', (event) => (
    isSender(event, mainWindow) ? clearSecureApiKey() : false
  ));
  ipcMain.handle('settings:test-model', (event, llm) => (
    isSender(event, mainWindow) ? testModelConnection(llm) : { ok: false, error: 'forbidden' }
  ));
  ipcMain.handle('settings:reset', (event) => (
    isSender(event, mainWindow) ? resetConsoleSettings() : false
  ));
  ipcMain.handle('character-packages:scan', (event) => (
    isSender(event, mainWindow) ? scanLocalCharacterPackages() : null
  ));
  ipcMain.handle('character-packages:open-folder', async (event) => {
    if (!isSender(event, mainWindow)) return false;
    fs.mkdirSync(characterPackagesRoot, { recursive: true });
    return (await shell.openPath(characterPackagesRoot)) === '';
  });

  ipcMain.handle('runtime:sync-console-state', (event, payload) => {
    if (!isSender(event, mainWindow) || !payload || typeof payload !== 'object') return false;
    const nextPets = Array.isArray(payload.pets)
      ? payload.pets.slice(0, 20).map(sanitizePetProfile).filter(Boolean)
      : [];
    if (!nextPets.length) return false;
    const previousPetId = activePet?.id;
    pets = nextPets;
    activePet = pets.find((pet) => pet.id === payload.activePetId) ?? pets[0];
    activeLlmSettings = sanitizeLlmSettings(payload.llm);
    if (previousPetId && previousPetId !== activePet.id) {
      stopActiveChat();
      stopPetWalk();
    }
    behavior = {
      alwaysOnTop: payload.behavior?.alwaysOnTop !== false,
      edgeSnap: payload.behavior?.edgeSnap !== false,
      movementEnabled: payload.behavior?.movementEnabled !== false,
      idleMotion: payload.behavior?.idleMotion !== false,
    };
    runtimeState.alwaysOnTop = behavior.alwaysOnTop;
    petWindow?.setAlwaysOnTop(runtimeState.alwaysOnTop, 'floating');
    if (behavior.movementEnabled === false || behavior.idleMotion === false) stopPetWalk();
    else if (runtimeState.uiState === 'idle') scheduleIdleWalk();
    broadcastProfile();
    broadcastState();
    return true;
  });

  ipcMain.handle('runtime:get-desktop-snapshot', (event) => (isKnownSender(event) ? safeDesktopSnapshot() : null));
  ipcMain.handle('chat:get-state', (event) => (
    isSender(event, bubbleWindow) ? chatSnapshotForPet() : { petId: '', messages: [], activeRequest: null }
  ));
  ipcMain.handle('chat:send-message', (event, message) => (
    isSender(event, bubbleWindow) ? startChatMessage(message) : { started: false, error: 'forbidden' }
  ));
  ipcMain.handle('chat:stop', (event) => (isSender(event, bubbleWindow) ? stopActiveChat() : false));
  ipcMain.handle('chat:clear', (event) => {
    if (!isSender(event, bubbleWindow) || !activePet?.id || activeChatRequest) return false;
    conversationsByPet.delete(activePet.id);
    void saveChatHistory();
    const snapshot = chatSnapshotForPet();
    emitChatEvent('chat:snapshot', snapshot);
    return true;
  });
  ipcMain.handle('runtime:preview-pet-animation', (event, animationId) => {
    if (!isKnownSender(event)) return false;
    return previewPetAnimationFromMain(animationId);
  });
  ipcMain.handle('pet-window:show', (event) => (isKnownSender(event) ? showPetWindow() : false));
  ipcMain.handle('pet-window:hide', (event) => (isKnownSender(event) ? hidePetWindow() : false));
  ipcMain.handle('pet-bubble:show', (event) => (isKnownSender(event) ? showBubbleWindow() : false));
  ipcMain.handle('pet-bubble:hide', (event) => (isKnownSender(event) ? hideBubbleWindow() : false));
  ipcMain.handle('pet-bubble:set-expanded', (event, expanded) => (
    isSender(event, bubbleWindow) ? setBubbleExpanded(expanded) : false
  ));
  ipcMain.handle('settings-window:show', (event) => {
    if (!isKnownSender(event)) return false;
    showSettingsWindow();
    return true;
  });
  ipcMain.handle('pet-window:reset-position', (event) => {
    if (!isKnownSender(event) || !petWindow) return false;
    stopPetWalk();
    const position = defaultPetPosition();
    setPetWindowPosition(position.x, position.y);
    saveRuntimeState();
    positionBubbleWindow();
    return true;
  });
  ipcMain.handle('pet-window:begin-move', (event, pointer) => {
    if (!isSender(event, petWindow) || !petWindow || !pointer || typeof pointer !== 'object') {
      return { started: false, reason: 'invalid' };
    }
    if (runtimeState.locked) return { started: false, reason: 'locked' };
    const screenX = Number(pointer.screenX);
    const screenY = Number(pointer.screenY);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || Math.abs(screenX) > 1e7 || Math.abs(screenY) > 1e7) {
      return { started: false, reason: 'invalid' };
    }
    stopPetWalk(false);
    const bounds = petWindow.getBounds();
    if (bounds.width !== PET_WIDTH || bounds.height !== PET_HEIGHT) {
      setPetWindowPosition(bounds.x, bounds.y);
    }
    const normalizedBounds = petWindow.getBounds();
    petMoveSession = {
      offsetX: screenX - normalizedBounds.x,
      offsetY: screenY - normalizedBounds.y,
    };
    setUiState('dragging');
    return { started: true };
  });
  ipcMain.handle('pet-window:move', (event, delta) => {
    if (!isSender(event, petWindow) || !petWindow || !delta || typeof delta !== 'object') return { moved: false, reason: 'invalid' };
    if (runtimeState.locked) return { moved: false, reason: 'locked' };
    let targetX;
    let targetY;
    if (petMoveSession && Number.isFinite(Number(delta.screenX)) && Number.isFinite(Number(delta.screenY))) {
      targetX = Number(delta.screenX) - petMoveSession.offsetX;
      targetY = Number(delta.screenY) - petMoveSession.offsetY;
    } else {
      const deltaX = Number(delta.deltaX);
      const deltaY = Number(delta.deltaY);
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || Math.abs(deltaX) > 240 || Math.abs(deltaY) > 240) {
        return { moved: false, reason: 'invalid' };
      }
      const bounds = petWindow.getBounds();
      targetX = bounds.x + deltaX;
      targetY = bounds.y + deltaY;
    }
    setPetWindowPosition(targetX, targetY);
    if (runtimeState.uiState !== 'dragging') setUiState('dragging');
    positionBubbleWindow();
    return { moved: true };
  });
  ipcMain.handle('pet-window:finish-move', (event) => {
    if (!isSender(event, petWindow)) return false;
    petMoveSession = null;
    saveRuntimeState();
    if (runtimeState.uiState === 'dragging') setUiState('idle');
    return true;
  });
  ipcMain.handle('pet-window:walk', (event, direction) => (
    isSender(event, petWindow)
      ? startPetWalk(direction, { distance: 72, speed: 54 })
      : { started: false, reason: 'forbidden' }
  ));

  ipcMain.on('pet-window:context-menu', (event) => {
    if (isSender(event, petWindow)) showPetContextMenu();
  });
  ipcMain.on('runtime:set-conversation-state', (event, state) => {
    if (isSender(event, bubbleWindow) && typeof state === 'string') setUiState(state);
  });
  ipcMain.on('pet-bubble:set-has-draft', (event, hasDraft) => {
    if (isSender(event, bubbleWindow)) bubbleHasDraft = hasDraft === true;
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('xin.yimian.desktop-pet-console');
  configureRuntimePaths();
  seedBundledCharacterPackages();
  loadRuntimeState();
  loadChatHistory();
  scanLocalCharacterPackages();
  registerCharacterAssetProtocol();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpc();
  createSettingsWindow();
  createPetWindow();
  createBubbleWindow();
  createTray();
  scheduleIdleWalk();

  globalShortcut.register('Ctrl+Alt+P', () => setClickThrough(!runtimeState.clickThrough));
  globalShortcut.register('Ctrl+Alt+Enter', showBubbleWindow);
});

app.on('second-instance', () => {
  showPetWindow();
  showSettingsWindow();
});

app.on('activate', () => {
  if (!petWindow) createPetWindow();
  showPetWindow();
});

app.on('before-quit', () => {
  stopPetWalk(false);
  clearIdleWalkTimer();
  saveRuntimeState();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
