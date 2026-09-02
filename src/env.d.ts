/// <reference types="vite/client" />

import type {
  BehaviorSettings,
  CharacterAnimationDefinition,
  CharacterPackageScanResult,
  ChatErrorCode,
  ChatMessage,
  ChatSendResult,
  ChatSnapshot,
  ConsoleSettingsLoadResult,
  ConsoleSettingsSaveResult,
  DesktopSnapshot,
  LlmSettings,
  ModelConnectionTestResult,
  PersistedConsoleState,
  PetProfile,
  PetUiState,
  RuntimePetState,
  SecureApiKeySaveResult,
  SecureApiKeyStatus,
} from './types';

type DisposeListener = () => void;

interface DesktopRuntimeApi {
  readonly isDesktop: boolean;
  readonly platform: string;
  loadConsoleSettings(): Promise<ConsoleSettingsLoadResult | null>;
  saveConsoleSettings(payload: PersistedConsoleState): Promise<ConsoleSettingsSaveResult>;
  getApiKeyStatus(): Promise<SecureApiKeyStatus>;
  saveApiKey(apiKey: string): Promise<SecureApiKeySaveResult>;
  clearApiKey(): Promise<boolean>;
  testModelConnection(llm: LlmSettings): Promise<ModelConnectionTestResult>;
  resetConsoleSettings(): Promise<boolean>;
  scanCharacterPackages(): Promise<CharacterPackageScanResult | null>;
  openCharacterPackagesFolder(): Promise<boolean>;
  syncConsoleState(payload: {
    activePetId: string;
    pets: PetProfile[];
    llm: LlmSettings;
    behavior: BehaviorSettings;
  }): Promise<boolean>;
  getDesktopSnapshot(): Promise<DesktopSnapshot>;
  previewPetAnimation(animationId: string): Promise<boolean>;
  showPet(): Promise<boolean>;
  hidePet(): Promise<boolean>;
  openPetInput(): Promise<boolean>;
  hidePetBubble(): Promise<boolean>;
  setBubbleExpanded(expanded: boolean): Promise<boolean>;
  openSettings(): Promise<boolean>;
  resetPetPosition(): Promise<boolean>;
  walkPet(direction: 'left' | 'right'): Promise<{
    started: boolean;
    direction?: 'left' | 'right';
    distance?: number;
    reason?: 'invalid' | 'locked' | 'busy' | 'boundary' | 'forbidden' | 'unavailable' | 'movement-disabled'
      | 'click-through' | 'dragging' | 'chat-active' | 'bubble-open';
  }>;
  beginPetMove(pointer: { screenX: number; screenY: number }): Promise<{ started: boolean; reason?: 'locked' | 'invalid' }>;
  movePetWindow(position: { screenX: number; screenY: number } | { deltaX: number; deltaY: number }): Promise<{ moved: boolean; reason?: 'locked' | 'invalid' }>;
  finishPetMove(): Promise<boolean>;
  showPetContextMenu(): void;
  setQuickInputOpen(open: boolean): Promise<boolean>;
  setConversationState(state: PetUiState): void;
  setBubbleHasDraft(hasDraft: boolean): void;
  getChatState(): Promise<ChatSnapshot>;
  sendChatMessage(message: string): Promise<ChatSendResult>;
  stopChat(): Promise<boolean>;
  clearChat(): Promise<boolean>;
  onPetProfileChanged(callback: (pet: PetProfile) => void): DisposeListener;
  onPetStateChanged(callback: (state: RuntimePetState) => void): DisposeListener;
  onPreviewPetAnimation(callback: (animation: CharacterAnimationDefinition) => void): DisposeListener;
  onSwitchPet(callback: (id: string) => void): DisposeListener;
  onBehaviorSettingChanged(callback: (payload: { key: 'speechBubbleSeconds'; value: number }) => void): DisposeListener;
  onQuickInputClose(callback: () => void): DisposeListener;
  onBubbleFocus(callback: () => void): DisposeListener;
  onStopConversation(callback: () => void): DisposeListener;
  onChatSnapshot(callback: (snapshot: ChatSnapshot) => void): DisposeListener;
  onChatChunk(callback: (payload: { requestId: string; delta: string }) => void): DisposeListener;
  onChatComplete(callback: (payload: { requestId: string; message: ChatMessage }) => void): DisposeListener;
  onChatError(callback: (payload: { requestId: string; code: ChatErrorCode; message?: ChatMessage }) => void): DisposeListener;
}

declare global {
  interface Window {
    desktopRuntime?: DesktopRuntimeApi;
  }
}
