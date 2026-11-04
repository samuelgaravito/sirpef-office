<script setup lang="ts">
import { Check, ExternalLink, KeyRound, Loader2, RefreshCw, Save, Sparkles, Trash2, UserRound, Users, Zap } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { api } from '@/api/client';
import { svaUsersUrl } from '@/lib/sva';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const toast = useToast();

const isSvaUser = computed(() => auth.user?.authProvider === 'sva');
const usersInSvaUrl = computed(() => svaUsersUrl());

const syncingUsers = ref(false);
const syncMessage = ref('');

async function syncUsers(): Promise<void> {
  if (syncingUsers.value) return;
  syncingUsers.value = true;
  syncMessage.value = '';
  try {
    const result = await api.post<{
      created: number;
      updated: number;
      deactivated: number;
      errors: string[];
    }>('/auth/sva/sync');
    syncMessage.value = `SVA: ${result.created} creados, ${result.updated} actualizados y ${result.deactivated} desactivados.`;
    if (result.errors.length > 0) {
      syncMessage.value += ` ${result.errors.length} incidencia(s): ${result.errors.slice(0, 3).join(' · ')}`;
    }
    toast.success('Usuarios sincronizados con SVA');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar con SVA';
    syncMessage.value = message;
    toast.error(message);
  } finally {
    syncingUsers.value = false;
  }
}

const profileName = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const savingProfile = ref(false);

interface AiSettings {
  provider: 'none' | 'openai' | 'anthropic' | 'gemini' | 'ollama';
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  hasApiKey: boolean;
  configured: boolean;
}

const ai = reactive<AiSettings & { apiKey: string }>({
  provider: 'none',
  baseUrl: '',
  model: '',
  temperature: 0.4,
  maxTokens: 2500,
  hasApiKey: false,
  configured: false,
  apiKey: '',
});

const loadingAi = ref(true);
const savingAi = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; latencyMs: number; sample: string } | null>(null);

const providerDefaults: Record<AiSettings['provider'], { baseUrl: string; model: string; needsKey: boolean }> = {
  none: { baseUrl: '', model: '', needsKey: false },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', needsKey: true },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash', needsKey: true },
  ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1', needsKey: false },
};

const needsKey = computed(() => providerDefaults[ai.provider].needsKey);

const providerLabels: Record<AiSettings['provider'], string> = {
  none: 'Sin IA (modo manual)',
  openai: 'OpenAI o compatible',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)',
};

function onProviderChange(): void {
  const defaults = providerDefaults[ai.provider];
  if (defaults.baseUrl) ai.baseUrl = defaults.baseUrl;
  if (defaults.model) ai.model = defaults.model;
  testResult.value = null;
}

async function loadAi(): Promise<void> {
  if (!auth.isAdmin) {
    loadingAi.value = false;
    return;
  }
  loadingAi.value = true;
  try {
    const data = await api.get<{ settings: AiSettings }>('/ai/settings');
    Object.assign(ai, data.settings, { apiKey: '' });
  } catch {
    // Un miembro no puede leer la configuración; se ignora.
  } finally {
    loadingAi.value = false;
  }
}

async function saveProfile(): Promise<void> {
  if (savingProfile.value) return;
  savingProfile.value = true;
  try {
    const payload: Record<string, unknown> = { name: profileName.value.trim() };
    if (newPassword.value) {
      payload.currentPassword = currentPassword.value;
      payload.newPassword = newPassword.value;
    }
    const data = await api.patch<{ user: typeof auth.user }>('/auth/me', payload);
    if (data.user) auth.user = data.user;
    currentPassword.value = '';
    newPassword.value = '';
    toast.success('Perfil actualizado');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el perfil');
  } finally {
    savingProfile.value = false;
  }
}

async function saveAi(): Promise<void> {
  if (savingAi.value) return;
  savingAi.value = true;
  try {
    const data = await api.put<{ settings: AiSettings }>('/ai/settings', {
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      temperature: ai.temperature,
      maxTokens: ai.maxTokens,
      ...(ai.apiKey ? { apiKey: ai.apiKey } : {}),
    });
    Object.assign(ai, data.settings, { apiKey: '' });
    toast.success('Configuración de IA guardada');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo guardar la configuración');
  } finally {
    savingAi.value = false;
  }
}

async function testAi(): Promise<void> {
  if (testing.value) return;
  testing.value = true;
  testResult.value = null;
  try {
    const result = await api.post<{ ok: boolean; latencyMs: number; sample: string }>('/ai/test');
    testResult.value = result;
    toast.success(`Conexión correcta en ${result.latencyMs} ms`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo conectar con el proveedor');
  } finally {
    testing.value = false;
  }
}

async function removeKey(): Promise<void> {
  try {
    const data = await api.del<{ settings: AiSettings }>('/ai/key');
    Object.assign(ai, data.settings, { apiKey: '' });
    toast.success('Clave eliminada');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la clave');
  }
}

onMounted(() => {
  profileName.value = auth.user?.name ?? '';
  void loadAi();
});
</script>

<template>
  <AppShell>
    <PageHeader title="Ajustes" subtitle="Tu perfil y la configuración del asistente de redacción." />

    <div class="mx-auto max-w-[820px] px-5 pb-14 pt-2 sm:px-8">
      <!-- Perfil -->
      <section class="card p-5">
        <header class="mb-4 flex items-center gap-2">
          <UserRound class="size-4 text-ink-muted" />
          <h2 class="text-[14px] font-semibold">Perfil</h2>
        </header>

        <div class="mb-5 flex items-center gap-3">
          <UserAvatar :name="auth.user?.name" :src="auth.user?.avatarUrl" size="lg" />
          <div>
            <p class="text-[13.5px] font-medium">{{ auth.user?.name }}</p>
            <p class="text-[12px] text-ink-muted">{{ auth.user?.email }}</p>
            <span class="chip mt-1">{{ auth.isAdmin ? 'Administrador' : 'Miembro' }}</span>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label">Nombre</label>
            <input v-model="profileName" class="field" :class="{ 'bg-surface-muted': isSvaUser }" :disabled="isSvaUser" />
          </div>
          <div>
            <label class="label">Correo (no editable)</label>
            <input :value="auth.user?.email" class="field bg-surface-muted" disabled />
          </div>
          <div v-if="isSvaUser">
            <label class="label">Cédula</label>
            <input :value="auth.user?.cedula ?? '—'" class="field bg-surface-muted" disabled />
          </div>
          <template v-else>
            <div>
              <label class="label">Contraseña actual</label>
              <input v-model="currentPassword" type="password" class="field" autocomplete="current-password" placeholder="Solo para cambiarla" />
            </div>
            <div>
              <label class="label">Nueva contraseña</label>
              <input v-model="newPassword" type="password" class="field" autocomplete="new-password" placeholder="Mínimo 8 caracteres" />
            </div>
          </template>
        </div>

        <p v-if="isSvaUser" class="mt-3 rounded-lg bg-accent-soft px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          Tu cuenta se administra en SVA. Para cambiar nombre, correo, cédula o contraseña,
          hazlo desde el portal SVA; SirpefOffice se actualiza automáticamente.
        </p>

        <div v-if="!isSvaUser" class="mt-4 flex justify-end">
          <button type="button" class="btn btn-primary" :disabled="savingProfile" @click="saveProfile">
            <component :is="savingProfile ? Loader2 : Save" :class="['size-4', savingProfile ? 'animate-spin' : '']" />
            {{ savingProfile ? 'Guardando…' : 'Guardar perfil' }}
          </button>
        </div>
      </section>

      <!-- SVA (solo administradores) -->
      <section v-if="auth.isAdmin && auth.authMode !== 'local'" class="card mt-5 p-5">
        <header class="mb-4 flex items-center gap-2">
          <RefreshCw class="size-4 text-ink-muted" />
          <h2 class="text-[14px] font-semibold">Usuarios de SVA</h2>
        </header>
        <p class="text-[12.5px] leading-relaxed text-ink-muted">
          SirpefOffice sincroniza automáticamente los usuarios asignados al sistema. Si acabas
          de crear o modificar un usuario en SVA, puedes forzar la actualización ahora.
        </p>
        <p v-if="syncMessage" class="mt-3 rounded-lg bg-accent-soft px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          {{ syncMessage }}
        </p>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <a
            v-if="usersInSvaUrl"
            :href="usersInSvaUrl"
            target="_blank"
            rel="noopener"
            class="btn btn-outline"
          >
            <ExternalLink class="size-4" />
            Gestionar usuarios en SVA
          </a>
          <button type="button" class="btn btn-outline" :disabled="syncingUsers" @click="syncUsers">
            <component :is="syncingUsers ? Loader2 : RefreshCw" :class="['size-4', syncingUsers ? 'animate-spin' : '']" />
            {{ syncingUsers ? 'Sincronizando…' : 'Sincronizar ahora' }}
          </button>
        </div>
      </section>

      <!-- Menús por usuario (solo administradores) -->
      <section v-if="auth.isAdmin" class="card mt-5 p-5">
        <header class="mb-4 flex items-center gap-2">
          <Users class="size-4 text-ink-muted" />
          <h2 class="text-[14px] font-semibold">Usuarios y menús</h2>
        </header>
        <p class="text-[12.5px] leading-relaxed text-ink-muted">
          Decide qué secciones ve cada usuario. Los menús son independientes del rol:
          un administrador también puede tener un menú reducido.
        </p>
        <div class="mt-4 flex justify-end">
          <RouterLink :to="{ name: 'settings-users' }" class="btn btn-outline">
            <Users class="size-4" />
            Gestionar menús por usuario
          </RouterLink>
        </div>
      </section>

      <!-- IA -->
      <section class="card mt-5 p-5">
        <header class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Sparkles class="size-4 text-ink-muted" />
            <h2 class="text-[14px] font-semibold">Asistente de IA</h2>
          </div>
          <span v-if="ai.configured" class="chip !bg-success-soft !text-success">
            <Check class="size-3" />
            Configurado
          </span>
          <span v-else class="chip">Modo manual</span>
        </header>

        <p v-if="!auth.isAdmin" class="rounded-lg bg-surface-muted px-3 py-3 text-[12.5px] text-ink-muted">
          Solo los administradores pueden configurar el proveedor de IA. Mientras tanto puedes rellenar
          los datos a mano en el editor.
        </p>

        <template v-else>
          <div v-if="loadingAi" class="py-6 text-center text-[12.5px] text-ink-muted">Cargando configuración…</div>

          <div v-else class="space-y-3.5">
            <div>
              <label class="label">Proveedor</label>
              <select v-model="ai.provider" class="field" @change="onProviderChange">
                <option v-for="(label, value) in providerLabels" :key="value" :value="value">{{ label }}</option>
              </select>
              <p class="mt-1 text-[11px] text-ink-subtle">
                Con «Sin IA» los documentos se rellenan manualmente, sin enviar nada a terceros.
              </p>
            </div>

            <template v-if="ai.provider !== 'none'">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label">URL base</label>
                  <input v-model="ai.baseUrl" class="field font-mono !text-[11.5px]" />
                </div>
                <div>
                  <label class="label">Modelo</label>
                  <input v-model="ai.model" class="field font-mono !text-[11.5px]" />
                </div>
              </div>

              <div v-if="needsKey">
                <label class="label">Clave de API</label>
                <div class="flex gap-2">
                  <input
                    v-model="ai.apiKey"
                    type="password"
                    class="field flex-1 font-mono !text-[11.5px]"
                    :placeholder="ai.hasApiKey ? '•••••••• (guardada) — deja vacío para conservarla' : 'sk-…'"
                    autocomplete="off"
                  />
                  <button v-if="ai.hasApiKey" type="button" class="btn btn-outline" title="Eliminar clave" @click="removeKey">
                    <Trash2 class="size-4" />
                  </button>
                </div>
                <p class="mt-1 text-[11px] text-ink-subtle">
                  La clave se guarda en la base de datos y nunca se devuelve al navegador.
                </p>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label">Temperatura ({{ ai.temperature.toFixed(2) }})</label>
                  <input v-model.number="ai.temperature" type="range" min="0" max="1.5" step="0.05" class="w-full accent-[var(--color-accent)]" />
                </div>
                <div>
                  <label class="label">Máximo de tokens</label>
                  <input v-model.number="ai.maxTokens" type="number" min="64" max="32000" step="64" class="field" />
                </div>
              </div>

              <div v-if="testResult" class="rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-[12px] text-success">
                Conexión correcta en {{ testResult.latencyMs }} ms · «{{ testResult.sample }}»
              </div>
            </template>

            <div class="flex flex-wrap justify-end gap-2 pt-1">
              <button
                v-if="ai.provider !== 'none'"
                type="button"
                class="btn btn-outline"
                :disabled="testing"
                @click="testAi"
              >
                <component :is="testing ? Loader2 : Zap" :class="['size-4', testing ? 'animate-spin' : '']" />
                {{ testing ? 'Probando…' : 'Probar conexión' }}
              </button>
              <button type="button" class="btn btn-primary" :disabled="savingAi" @click="saveAi">
                <component :is="savingAi ? Loader2 : Save" :class="['size-4', savingAi ? 'animate-spin' : '']" />
                {{ savingAi ? 'Guardando…' : 'Guardar IA' }}
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- Acerca de -->
      <section class="card mt-5 p-5">
        <header class="mb-3 flex items-center gap-2">
          <KeyRound class="size-4 text-ink-muted" />
          <h2 class="text-[14px] font-semibold">Acerca de SirpefOffice</h2>
        </header>
        <dl class="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div class="flex justify-between rounded-lg bg-surface-muted px-3 py-2">
            <dt class="text-ink-muted">Versión</dt>
            <dd class="font-medium">0.1.0</dd>
          </div>
          <div class="flex justify-between rounded-lg bg-surface-muted px-3 py-2">
            <dt class="text-ink-muted">Editor</dt>
            <dd class="font-medium">TipTap 3</dd>
          </div>
          <div class="flex justify-between rounded-lg bg-surface-muted px-3 py-2">
            <dt class="text-ink-muted">Exportación</dt>
            <dd class="font-medium">PDF · DOCX · HTML</dd>
          </div>
          <div class="flex justify-between rounded-lg bg-surface-muted px-3 py-2">
            <dt class="text-ink-muted">Numeración</dt>
            <dd class="font-medium">MEM / NDE / INF…</dd>
          </div>
        </dl>
      </section>
    </div>
  </AppShell>
</template>
