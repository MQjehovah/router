<template>
  <el-input
    :model-value="displayValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :size="size"
    @focus="onFocus"
    @input="onInput"
    @blur="onBlur"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: number | null;
    placeholder?: string;
    disabled?: boolean;
    size?: 'default' | 'small' | 'large';
  }>(),
  {
    modelValue: 0,
    placeholder: '0 = 不限',
    disabled: false,
    size: 'default'
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void;
}>();

const focused = ref(false);
const editing = ref('');

const format = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '' : n.toLocaleString('en-US');

const displayValue = computed(() => (focused.value ? editing.value : format(props.modelValue)));

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) editing.value = '';
  }
);

function onFocus() {
  focused.value = true;
  editing.value = props.modelValue == null ? '' : String(props.modelValue);
}

function onInput(v: string) {
  editing.value = v.replace(/[^\d]/g, '');
  emit('update:modelValue', editing.value === '' ? 0 : Number(editing.value));
}

function onBlur() {
  focused.value = false;
}
</script>
