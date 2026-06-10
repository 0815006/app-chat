<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  src: string
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const isVisible = ref(props.visible)

watch(() => props.visible, (val) => {
  isVisible.value = val
})

function close() {
  emit('close')
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isVisible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      @click="onOverlayClick"
    >
      <button
        class="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
        @click="close"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
          <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
        </svg>
      </button>
      <img
        :src="src"
        alt="预览图片"
        class="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        @click.stop
      />
    </div>
  </Teleport>
</template>