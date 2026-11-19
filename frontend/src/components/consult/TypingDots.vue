<template>
  <span class="inline-flex items-center gap-1" aria-label="Pensando">
    <span class="dot" />
    <span class="dot" />
    <span class="dot" />
  </span>
</template>

<style scoped>
.dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.65);
  animation: dot-bounce 1.1s infinite ease-in-out;
}

.dot:nth-child(2) {
  animation-delay: 0.12s;
}

.dot:nth-child(3) {
  animation-delay: 0.24s;
}

@keyframes dot-bounce {
  0%,
  70%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  35% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none;
    opacity: 0.7;
  }
}
</style>
