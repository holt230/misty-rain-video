<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { siteSettings } from '../../services/siteSettings';
import { withAppBase } from '../../services/appUrl';
const failed = ref(false);
const brandMarkUrl = computed(() => failed.value ? withAppBase('/brand-mark.png') : siteSettings.value.iconUrl);
watch(() => siteSettings.value.iconUrl, () => { failed.value = false; });
</script>

<template>
  <img
    class="brand-mark-image"
    :src="brandMarkUrl"
    @error="failed = true"
    alt=""
    aria-hidden="true"
    decoding="async"
    draggable="false"
  />
</template>

<style scoped>
.brand-mark-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}
</style>
