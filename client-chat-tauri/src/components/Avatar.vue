<script setup lang="ts">
interface Props {
  name: string
  online?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** 头像图片 URL，有则显示图片，无则显示首字母 */
  avatarUrl?: string
  /** 是否可点击（点击弹出个人信息弹窗） */
  clickable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  online: false,
  size: 'md',
  avatarUrl: undefined,
  clickable: false,
})

const emit = defineEmits<{ click: [] }>()

const sizeMap: Record<string, { container: string; font: string }> = {
  sm: { container: 'w-9 h-9', font: 'text-sm' },
  md: { container: 'w-10 h-10', font: 'text-base' },
  lg: { container: 'w-14 h-14', font: 'text-lg' },
}
</script>

<template>
  <div
    class="avatar-wrapper"
    :class="{ 'cursor-pointer': clickable }"
    @click="clickable && emit('click')"
  >
    <!-- 有图片时显示真实头像 -->
    <img
      v-if="avatarUrl"
      :src="avatarUrl"
      :alt="name"
      :class="['avatar-img', sizeMap[size].container]"
    />
    <!-- 无图片时显示首字母 -->
    <div
      v-else
      :class="['avatar-circle', sizeMap[size].container, sizeMap[size].font]"
    >
      {{ name[0] ?? '?' }}
    </div>
    <span v-if="online" class="online-dot" />
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
  overflow: hidden;
}

.avatar-img {
  border-radius: 50%;
  object-fit: cover;
}

.online-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #48bb78;
  border: 2px solid var(--color-bg-elevated);
}
</style>