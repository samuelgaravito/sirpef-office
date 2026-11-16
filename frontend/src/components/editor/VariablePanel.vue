<script setup lang="ts">
import { ImagePlus, Plus, Sparkles, Trash2 } from 'lucide-vue-next';
import { computed } from 'vue';

import { NUMBERING_MESSAGES, type NumberingPreview, type VariableDef, type VariableValues } from '@sirpefoffice/shared';

import NumberingBadge from '@/components/editor/NumberingBadge.vue';

const props = withDefaults(
  defineProps<{
    schema: VariableDef[];
    modelValue: VariableValues;
    disabled?: boolean;
    aiEnabled?: boolean;
    generating?: boolean;
    /** Número ya asignado al documento. */
    docNumber?: string | null;
    /** Número previsto mientras el documento es borrador. */
    numbering?: NumberingPreview | null;
  }>(),
  {
    disabled: false,
    aiEnabled: true,
    generating: false,
    docNumber: null,
    numbering: null,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: VariableValues];
  generate: [];
}>();

type Row = Record<string, unknown>;

function setValue(key: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function valueOf(key: string): unknown {
  return props.modelValue[key];
}

function stringValue(key: string): string {
  const value = props.modelValue[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

function rowsOf(key: string): Row[] {
  const value = props.modelValue[key];
  return Array.isArray(value) ? (value as Row[]) : [];
}

function addRow(variable: VariableDef): void {
  const row: Row = {};
  for (const column of variable.columns ?? []) row[column.key] = '';
  setValue(variable.key, [...rowsOf(variable.key), row]);
}

function updateRow(variable: VariableDef, index: number, column: string, value: unknown): void {
  const rows = rowsOf(variable.key).map((row, i) => (i === index ? { ...row, [column]: value } : row));
  setValue(variable.key, rows);
}

function removeRow(variable: VariableDef, index: number): void {
  setValue(
    variable.key,
    rowsOf(variable.key).filter((_, i) => i !== index),
  );
}

function readImage(variable: VariableDef, event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => setValue(variable.key, String(reader.result ?? ''));
  reader.readAsDataURL(file);
}

const grouped = computed(() => props.schema);

const missingRequired = computed(() =>
  props.schema.filter((variable) => {
    if (!variable.required) return false;
    const value = props.modelValue[variable.key];
    if (variable.type === 'table') return !Array.isArray(value) || value.length === 0;
    if (variable.type === 'checkbox') return false;
    return value === undefined || value === null || value === '';
  }),
);
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-start justify-between gap-2 border-b border-hairline px-4 py-3">
      <div>
        <h2 class="text-[15px] font-semibold">Datos del documento</h2>
        <p class="text-meta mt-0.5">
          {{ schema.length }} campo{{ schema.length === 1 ? '' : 's' }}
          <template v-if="missingRequired.length">
            · <span class="text-warning">{{ missingRequired.length }} obligatorio{{ missingRequired.length === 1 ? '' : 's' }} sin completar</span>
          </template>
        </p>
      </div>
      <button
        v-if="aiEnabled"
        type="button"
        class="btn btn-outline btn-sm"
        :disabled="generating || disabled"
        @click="emit('generate')"
      >
        <Sparkles class="size-3.5" :class="{ 'animate-pulse': generating }" />
        {{ generating ? 'Redactando…' : 'IA' }}
      </button>
    </header>

    <div class="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
      <!-- Número de documento: variable de sistema, no editable -->
      <div class="rounded-lg border border-hairline bg-surface-muted/40 px-3 py-2.5">
        <p class="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
          {{ NUMBERING_MESSAGES.variableLabel }}
        </p>
        <NumberingBadge :doc-number="docNumber" :numbering="numbering" variant="full" />
      </div>

      <p v-if="schema.length === 0" class="text-description">
        Esta plantilla no define variables. Puedes escribir libremente en el documento.
      </p>

      <div v-for="variable in grouped" :key="variable.key">
        <label class="label flex items-center gap-1" :for="`var-${variable.key}`">
          {{ variable.label }}
          <span v-if="variable.required" class="text-danger">*</span>
        </label>

        <!-- Explicación del campo: qué se espera escribir aquí. -->
        <p
          v-if="variable.description && variable.type !== 'checkbox'"
          class="mb-1.5 -mt-0.5 text-[12.5px] leading-snug text-ink-muted"
        >
          {{ variable.description }}
        </p>

        <!-- Texto corto -->
        <input
          v-if="variable.type === 'text' || variable.type === 'user'"
          :id="`var-${variable.key}`"
          class="field"
          :value="stringValue(variable.key)"
          :disabled="disabled"
          :placeholder="variable.aiHint ?? ''"
          @input="setValue(variable.key, ($event.target as HTMLInputElement).value)"
        />

        <!-- Texto largo -->
        <textarea
          v-else-if="variable.type === 'longtext'"
          :id="`var-${variable.key}`"
          class="field min-h-[92px]"
          :value="stringValue(variable.key)"
          :disabled="disabled"
          :placeholder="variable.aiHint ?? ''"
          @input="setValue(variable.key, ($event.target as HTMLTextAreaElement).value)"
        />

        <!-- Fecha -->
        <input
          v-else-if="variable.type === 'date'"
          :id="`var-${variable.key}`"
          type="date"
          class="field"
          :value="stringValue(variable.key)"
          :disabled="disabled"
          @input="setValue(variable.key, ($event.target as HTMLInputElement).value)"
        />

        <!-- Número / moneda -->
        <div v-else-if="variable.type === 'number' || variable.type === 'money'" class="relative">
          <span v-if="variable.type === 'money'" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-subtle">S/</span>
          <input
            :id="`var-${variable.key}`"
            type="number"
            :step="variable.type === 'money' ? '0.01' : '1'"
            class="field"
            :class="{ 'pl-8': variable.type === 'money' }"
            :value="stringValue(variable.key)"
            :disabled="disabled"
            @input="setValue(variable.key, ($event.target as HTMLInputElement).value)"
          />
        </div>

        <!-- Selección -->
        <select
          v-else-if="variable.type === 'select'"
          :id="`var-${variable.key}`"
          class="field"
          :value="stringValue(variable.key)"
          :disabled="disabled"
          @change="setValue(variable.key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">—</option>
          <option v-for="option in variable.options ?? []" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <!-- Selección múltiple -->
        <div v-else-if="variable.type === 'multiselect'" class="flex flex-wrap gap-2">
          <label
            v-for="option in variable.options ?? []"
            :key="option.value"
            class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-[13px]"
          >
            <input
              type="checkbox"
              class="accent-[var(--color-accent)]"
              :checked="Array.isArray(valueOf(variable.key)) && (valueOf(variable.key) as string[]).includes(option.value)"
              :disabled="disabled"
              @change="
                setValue(
                  variable.key,
                  ($event.target as HTMLInputElement).checked
                    ? [...((valueOf(variable.key) as string[]) ?? []), option.value]
                    : ((valueOf(variable.key) as string[]) ?? []).filter((v) => v !== option.value),
                )
              "
            />
            {{ option.label }}
          </label>
        </div>

        <!-- Casilla -->
        <label v-else-if="variable.type === 'checkbox'" class="flex cursor-pointer items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            class="accent-[var(--color-accent)]"
            :checked="Boolean(valueOf(variable.key))"
            :disabled="disabled"
            @change="setValue(variable.key, ($event.target as HTMLInputElement).checked)"
          />
          {{ variable.description ?? 'Sí' }}
        </label>

        <!-- Imagen -->
        <div v-else-if="variable.type === 'image'" class="flex items-center gap-2">
          <label class="btn btn-outline btn-sm cursor-pointer">
            <ImagePlus class="size-3.5" />
            Subir imagen
            <input type="file" accept="image/*" class="hidden" :disabled="disabled" @change="readImage(variable, $event)" />
          </label>
          <img
            v-if="stringValue(variable.key)"
            :src="stringValue(variable.key)"
            alt="Vista previa"
            class="h-10 w-10 rounded object-cover"
          />
        </div>

        <!-- Tabla -->
        <div v-else-if="variable.type === 'table'" class="overflow-hidden rounded-lg border border-hairline">
          <table class="w-full border-collapse text-[12.5px]">
            <thead class="bg-surface-muted">
              <tr>
                <th v-for="column in variable.columns ?? []" :key="column.key" class="border-b border-hairline px-2 py-1.5 text-left font-medium text-ink-muted">
                  {{ column.label }}
                </th>
                <th class="w-8 border-b border-hairline" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rowsOf(variable.key)" :key="index" class="border-b border-hairline last:border-0">
                <td v-for="column in variable.columns ?? []" :key="column.key" class="p-1">
                  <input
                    class="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] focus:border-accent focus:bg-surface focus:outline-none"
                    :type="column.type === 'number' || column.type === 'money' ? 'number' : column.type === 'date' ? 'date' : 'text'"
                    :value="row[column.key] ?? ''"
                    :disabled="disabled"
                    @input="updateRow(variable, index, column.key, ($event.target as HTMLInputElement).value)"
                  />
                </td>
                <td class="p-1 text-center">
                  <button type="button" class="rounded p-1 text-ink-subtle hover:bg-danger-soft hover:text-danger" :disabled="disabled" @click="removeRow(variable, index)">
                    <Trash2 class="size-3" />
                  </button>
                </td>
              </tr>
              <tr v-if="rowsOf(variable.key).length === 0">
                <td :colspan="(variable.columns?.length ?? 1) + 1" class="px-2 py-3 text-center text-[12.5px] text-ink-subtle">
                  Sin filas
                </td>
              </tr>
            </tbody>
          </table>
          <button
            type="button"
            class="flex w-full items-center justify-center gap-1 border-t border-hairline bg-surface-muted/50 py-2 text-[13px] font-medium text-accent hover:bg-accent-soft"
            :disabled="disabled"
            @click="addRow(variable)"
          >
            <Plus class="size-3" />
            Añadir fila
          </button>
        </div>

        <p v-if="variable.aiHint && variable.type !== 'text' && variable.type !== 'longtext'" class="mt-1 text-[12.5px] leading-snug text-ink-subtle">
          {{ variable.aiHint }}
        </p>
      </div>
    </div>
  </div>
</template>
