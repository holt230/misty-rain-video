<template>
  <div class="skeleton-resource-card"></div>
</template>

<style scoped>
.skeleton-resource-card {
  height: 88px;
  background: linear-gradient(90deg, rgb(255 255 255 / .035) 25%, rgb(255 255 255 / .085) 50%, rgb(255 255 255 / .035) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
  border-radius: 24px;
  border: var(--glass-border);
  margin-top: 12px;
}
@media (prefers-reduced-motion: reduce) { .skeleton-resource-card { animation: none; } }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
