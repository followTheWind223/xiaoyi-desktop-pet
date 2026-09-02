<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import AppSidebar from './components/AppSidebar.vue';
import AppTopbar from './components/AppTopbar.vue';
import BehaviorSettings from './components/BehaviorSettings.vue';
import DataSettings from './components/DataSettings.vue';
import ModelSettings from './components/ModelSettings.vue';
import OverviewPage from './components/OverviewPage.vue';
import PetManagement from './components/PetManagement.vue';
import VoiceSettings from './components/VoiceSettings.vue';
import { useConsoleStore } from './stores/console';

const store = useConsoleStore();
const contentArea = ref<HTMLElement | null>(null);
const desktopAvailable = Boolean(window.desktopRuntime?.isDesktop);

function showPet() {
  void window.desktopRuntime?.showPet();
}

function openPetInput() {
  void window.desktopRuntime?.openPetInput();
}

const currentPage = computed(() => {
  switch (store.activeSection) {
    case 'overview': return OverviewPage;
    case 'pets': return PetManagement;
    case 'model': return ModelSettings;
    case 'voice': return VoiceSettings;
    case 'behavior': return BehaviorSettings;
    case 'data': return DataSettings;
  }
});

watch(
  () => store.activeSection,
  async () => {
    await nextTick();
    contentArea.value?.scrollTo({ top: 0, behavior: 'instant' });
  },
);
</script>

<template>
  <div class="app-shell">
    <AppSidebar :active="store.activeSection" @select="store.activeSection = $event" />
    <div class="workspace">
      <AppTopbar
        :pet="store.activePet"
        :save-state="store.saveState"
        :storage-label="store.configurationStorageLabel"
        :desktop-available="desktopAvailable"
        @manage-pet="store.activeSection = 'pets'"
        @show-pet="showPet"
        @open-input="openPetInput"
      />
      <main ref="contentArea" class="content-area">
        <Transition name="page-fade" mode="out-in">
          <component :is="currentPage" :key="store.activeSection" />
        </Transition>
      </main>
    </div>
  </div>
</template>
