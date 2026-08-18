<script setup lang="ts">
import { withAppBase } from '../../services/appUrl';

const brandMarkUrl = withAppBase('brand-mark.png');
</script>

<template>
  <img
    class="brand-mark-image"
    :src="brandMarkUrl"
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
