<script setup lang="ts">
import petReference from '../assets/pet-reference.png';
import type { PetProfile } from '../types';

defineProps<{ pet: PetProfile; size?: 'small' | 'medium' | 'large' }>();
</script>

<template>
  <div :class="['pet-avatar', size ?? 'medium']" :style="{ '--pet-accent': pet.accent }">
    <img v-if="pet.avatarKind === 'image'" :src="petReference" :alt="`${pet.name} 角色预览`" width="134" height="134" />
    <span
      v-else-if="pet.avatarKind === 'spritesheet' && pet.sprite"
      class="sprite-avatar-frame"
      :style="{
        backgroundImage: `url('${pet.sprite.assetUrl}')`,
        backgroundSize: `${pet.sprite.columns * 100}% ${pet.sprite.rows * 100}%`,
      }"
      role="img"
      :aria-label="`${pet.name} 动态角色预览`"
    />
    <span v-else>{{ pet.avatarValue }}</span>
  </div>
</template>
