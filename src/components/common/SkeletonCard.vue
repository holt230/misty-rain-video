<template>
  <div class="skeleton-resource-card" aria-hidden="true"></div>
</template>

<style scoped>
.skeleton-resource-card { position: relative; overflow: hidden; height: 88px; margin-top: 12px; border: var(--glass-border); border-radius: 18px; background: var(--surface-2); }
.skeleton-resource-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 20%, var(--skeleton-highlight), transparent 80%); animation: shimmer 1.8s ease-in-out infinite; }
@keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .skeleton-resource-card::after { animation: none; } }
</style>
