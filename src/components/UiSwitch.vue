<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; description?: string; disabled?: boolean }>();
</script>

<template>
  <label :class="['switch-row', { disabled }]">
    <span class="switch-copy">
      <strong>{{ label }}</strong>
      <small v-if="description">{{ description }}</small>
    </span>
    <button
      class="switch-control"
      type="button"
      role="switch"
      :aria-checked="model"
      :disabled="disabled"
      @click="model = !model"
    >
      <span />
    </button>
  </label>
</template>
