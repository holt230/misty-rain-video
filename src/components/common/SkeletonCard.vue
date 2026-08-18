<template>
  <div class="skeleton-resource-card"></div>
</template>

<style scoped>
.skeleton-resource-card {
  height: 88px;
  background: linear-gradient(90deg, rgba(255,255,255,0.025) 25%, rgba(255,255,255,0.065) 50%, rgba(255,255,255,0.025) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.055);
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
