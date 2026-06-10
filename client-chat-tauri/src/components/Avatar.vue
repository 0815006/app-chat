<script setup lang="ts">
interface Props {
  name: string
  online?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  online: false,
  size: 'md',
})

const sizeMap: Record<string, { container: string; font: string }> = {
  sm: { container: 'w-9 h-9', font: 'text-sm' },
  md: { container: 'w-10 h-10', font: 'text-base' },
  lg: { container: 'w-14 h-14', font: 'text-lg' },
}
</script>

<template>
  <div class="avatar-wrapper">
    <div :class="['avatar-circle', sizeMap[size].container, sizeMap[size].font]">
      {{ name[0] ?? '?' }}
    </div>
    <span v-if="props.online" class="online-dot" />
  </div>
</template>

<style scoped>
.avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.avatar-circle {
  border-radius: 50%;
  background: linear-gradient(135deg, #4299e1, #48bb78);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

.online-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #48bb78;
  border: 2px solid #162230;
}
</style>