<template>
  <a class="skip-link" href="#app-main">跳到主内容</a>
  <router-view />
</template>

<script setup lang="ts">
</script>

<style scoped>
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 999;
  padding: 8px 16px;
  background: var(--brand);
  color: #06202a;
  font-weight: 600;
  border-radius: 0 0 8px 0;
}
.skip-link:focus {
  left: 0;
}
</style>
