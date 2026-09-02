export type SectionKey =
  | 'overview'
  | 'pets'
  | 'model'
  | 'voice'
  | 'behavior'
  | 'data';

export interface PetProfile {
  id: string;
  name: string;
  subtitle: string;
  personality: string;
  voice: string;
  wakePhrase: string;
  accent: string;
  avatarKind: 'image' | 'glyph' | 'spritesheet';
  avatarValue: string;
  enabled: boolean;
  source?: 'builtin' | 'character-package';
  packageId?: string;
  sprite?: CharacterSpriteRuntime;
}

export interface CharacterSpriteRuntime {
  assetUrl: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  frameWidth: number | null;
  frameHeight: number | null;
  fps: number;
  stateRows: Record<PetUiState, number>;
  animations: CharacterAnimationDefinition[];
}

export interface CharacterAnimationDefinition {
  id: string;
  label: string;
  row: number;
  mode: 'loop' | 'once';
  states: PetUiState[];
  fps?: number;
}

export interface LlmSettings {
  profileName: string;
  modelUrl: string;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutSeconds: number;
  streaming: boolean;
  toolCalling: boolean;
}

export type ChatErrorCode =
  | 'model-not-configured'
  | 'api-key-missing'
  | 'api-key-unreadable'
  | 'secure-storage-unavailable'
  | 'unsafe-endpoint'
  | 'authentication'
  | 'model-or-endpoint-not-found'
  | 'rate-limited'
  | 'provider-unavailable'
  | 'request-rejected'
  | 'invalid-response'
  | 'empty-response'
  | 'response-too-large'
  | 'timeout'
  | 'network'
  | 'cancelled'
  | 'busy'
  | 'invalid-message'
  | 'pet-unavailable'
  | 'forbidden';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatSnapshot {
  petId: string;
  messages: ChatMessage[];
  activeRequest: { id: string; status: 'thinking' | 'speaking'; partial: string } | null;
}

export interface ChatSendResult {
  started: boolean;
  requestId?: string;
  error?: ChatErrorCode;
}

export interface ModelConnectionTestResult {
  ok: boolean;
  error?: ChatErrorCode;
}

export interface VoiceSettings {
  inputDevice: string;
  outputDevice: string;
  sttModel: string;
  ttsModel: string;
  speaker: string;
  speed: number;
  wakeSensitivity: 'low' | 'medium' | 'high';
  wakeEnabled: boolean;
  localOnly: boolean;
}

export interface BehaviorSettings {
  alwaysOnTop: boolean;
  edgeSnap: boolean;
  startWithSystem: boolean;
  movementEnabled: boolean;
  idleMotion: boolean;
  clickThroughShortcut: boolean;
  quietMode: boolean;
  quietStart: string;
  quietEnd: string;
}

export interface PersistedConsoleState {
  activePetId: string;
  pets: PetProfile[];
  llm: LlmSettings;
  voice: VoiceSettings;
  behavior: BehaviorSettings;
}

export type SettingsSaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

export interface SecureApiKeyStatus {
  available: boolean;
  stored: boolean;
  provider: string;
  error?: 'unreadable';
}

export interface ConsoleSettingsLoadResult {
  settings: PersistedConsoleState | null;
  storage: {
    kind: 'user-data-file';
    persistent: boolean;
  };
}

export interface ConsoleSettingsSaveResult {
  saved: boolean;
  reason?: 'invalid' | 'too-large' | 'write-failed' | 'forbidden';
}

export interface SecureApiKeySaveResult extends Partial<SecureApiKeyStatus> {
  saved: boolean;
  reason?: 'invalid' | 'unavailable' | 'write-failed' | 'forbidden';
}

export type PetUiState =
  | 'idle'
  | 'hover'
  | 'input_open'
  | 'moving_right'
  | 'moving_left'
  | 'dragging'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'sleeping'
  | 'error';

export interface RuntimePetState {
  uiState: PetUiState;
  visible: boolean;
  locked: boolean;
  clickThrough: boolean;
  muted: boolean;
  wakePaused: boolean;
  alwaysOnTop: boolean;
}

export interface DesktopSnapshot {
  activePet: PetProfile | null;
  runtime: RuntimePetState;
}

export interface CharacterPackageManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  spriteVersionNumber?: number;
  atlas?: {
    columns: number;
    rows: number;
  };
  animations?: CharacterAnimationDefinition[];
  behavior?: {
    fps?: number;
    idleRows?: number[];
    walkRightRow?: number;
    walkLeftRow?: number;
    thinkingRow?: number;
    talkingRow?: number;
    draggingRow?: number;
  };
}

export interface CharacterWebpMetadata {
  format: 'webp';
  codec: 'VP8' | 'VP8L' | 'VP8X';
  width: number;
  height: number;
  bytes: number;
  animated: boolean;
  atlas: {
    columns: number;
    rows: number;
    frameWidth: number | null;
    frameHeight: number | null;
    referenceCompatible: boolean;
  };
}

export interface CharacterPackage {
  id: string;
  folderName: string;
  manifest: CharacterPackageManifest;
  image: CharacterWebpMetadata;
  assetUrl: string;
}

export interface CharacterPackageIssue {
  folderName: string;
  code: string;
  message: string;
}

export interface CharacterPackageScanResult {
  rootPath: string;
  scannedAt: string;
  packages: CharacterPackage[];
  issues: CharacterPackageIssue[];
}
