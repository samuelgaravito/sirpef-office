<script setup lang="ts">
import { Bell, BellOff, BellRing, Check, CheckCircle2, ClipboardCopy, ExternalLink, KeyRound, Loader2, RefreshCw, Save, Server, Sparkles, Trash2, UserRound, Users, XCircle, Zap } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { api } from '@/api/client';
import { svaUsersUrl } from '@/lib/sva';
import { useNotifications } from '@/composables/useNotifications';
import { useToast } from '@/composables/useToast';
import { useUiMode } from '@/composables/useUiMode';
import { errorMessage as explainError } from '@/lib/error-message';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const toast = useToast();
const notifications = useNotifications();
const { essential, setEssential } = useUiMode();
const {
  permission: notifyPermission,
  muted: notifyMuted,
  supported: notifySupported,
} = notifications;

const notificationStatus = computed(() => {
  if (!notifySupported.value) return 'Este navegador no admite avisos del sistema.';
  if (notifyPermission.value === 'denied') {
    return 'El navegador tiene bloqueados los avisos de este sitio. Actívalos desde sus ajustes.';
  }
  if (notifyPermission.value !== 'granted') {
    return 'Aún no has activado los avisos del sistema.';
  }
  return notifyMuted.value
    ? 'Los avisos del sistema están silenciados; la campana de la aplicación seguirá saliendo.'
    : 'Recibirás un aviso del sistema cuando llegue algo y no estés mirando la aplicación.';
});

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
    const message = explainError(error, 'No se pudo sincronizar con SVA');
    syncMessage.value = message;
    toast.failure(error, 'No se pudo sincronizar con SVA');
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
    toast.failure(error, 'No se pudo actualizar el perfil');
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
    toast.failure(error, 'No se pudo guardar la configuración');
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
    toast.failure(error, 'No se pudo conectar con el proveedor');
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
    toast.failure(error, 'No se pudo eliminar la clave');
  }
}

interface DiagnosticCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

const diagnostics = ref<DiagnosticCheck[]>([]);
const diagnosticsAt = ref<string | null>(null);
const diagnosticsLoading = ref(false);

/** Comprueba Chrome, base de datos y carpeta de exportación. */
async function runDiagnostics(): Promise<void> {
  if (diagnosticsLoading.value) return;
  diagnosticsLoading.value = true;
  try {
    const data = await api.get<{ checks: DiagnosticCheck[]; generatedAt: string }>(
      '/system/diagnostics',
    );
    diagnostics.value = data.checks;
    diagnosticsAt.value = data.generatedAt;
    if (data.checks.every((check) => check.ok)) {
      toast.success('Todo listo para generar PDF y vistas previas');
    } else {
      toast.warning('Hay algo que revisar en el sistema');
    }
  } catch (error) {
    toast.failure(error, 'No se pudo comprobar el sistema');
  } finally {
    diagnosticsLoading.value = false;
  }
}

/** Copia un informe listo para pegar en un correo de soporte. */
async function copyDiagnostics(): Promise<void> {
  const report = {
    generado: diagnosticsAt.value ?? new Date().toISOString(),
    usuario: auth.user?.email ?? null,
    navegador: navigator.userAgent,
    url: window.location.href,
    comprobaciones: diagnostics.value,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast.success('Informe copiado al portapapeles');
  } catch {
    toast.error('El navegador no permitió copiar el informe');
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

      <!-- Avisos -->
      <section class="card mt-5 p-5">
        <header class="mb-4 flex items-center gap-2">
          <Bell class="size-4 text-ink-muted" />
          <h2 class="text-[14px] font-semibold">Avisos</h2>
        </header>

        <p class="text-[12.5px] leading-relaxed text-ink-muted">
          Recibe un aviso del sistema cuando llegue un mensaje, una aprobación o un rechazo a
          tu bandeja y no estés mirando la aplicación. Funciona mientras SirpefOffice siga
          abierto en alguna pestaña.
        </p>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            v-if="notifySupported && notifyPermission === 'default'"
            type="button"
            class="btn btn-primary"
            @click="notifications.requestPermission()"
          >
            <BellRing class="size-4" />
            Activar avisos del sistema
          </button>
          <button
            v-else-if="notifyPermission === 'granted'"
            type="button"
            class="btn btn-outline"
            @click="notifications.toggleMuted()"
          >
            <component :is="notifyMuted ? BellRing : BellOff" class="size-4" />
            {{ notifyMuted ? 'Reactivar avisos' : 'Silenciar avisos' }}
          </button>

          <span class="chip">
            {{
              !notifySupported
                ? 'No compatibles'
                : notifyPermission === 'denied'
                  ? 'Bloqueados'
                  : notifyPermission === 'granted'
                    ? notifyMuted
                      ? 'Silenciados'
                      : 'Activados'
                    : 'Sin activar'
            }}
          </span>
        </div>

        <p class="mt-3 text-[12px] leading-relaxed text-ink-subtle">{{ notificationStatus }}</p>
      </section>

      <!-- Interfaz -->
      <section class="card mt-5 p-5">
        <header class="mb-4 flex items-center gap-2">
          <Sparkles class="size-4 text-ink-muted" />
          <h2 class="text-[14px] font-semibold">Interfaz</h2>
        </header>

        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            class="mt-0.5 size-4 accent-[var(--color-accent)]"
            :checked="essential"
            @change="setEssential(($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0">
            <span class="block text-[13.5px] font-medium text-ink">Solo lo esencial</span>
            <span class="text-description mt-0.5 block">
              Deja en el editor solo Guardar, Vista previa, Enviar y las descargas. Oculta
              historial, cabecera y pie, compartir y formatos técnicos.
            </span>
          </span>
        </label>
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

      <!-- Diagnóstico del sistema (solo administradores) -->
      <section v-if="auth.isAdmin" class="card mt-5 p-5">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Server class="size-4 text-ink-muted" />
            <h2 class="text-[14px] font-semibold">Sistema</h2>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="diagnostics.length > 0"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="copyDiagnostics"
            >
              <ClipboardCopy class="size-4" />
              Copiar informe
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              :disabled="diagnosticsLoading"
              @click="runDiagnostics"
            >
              <component
                :is="diagnosticsLoading ? Loader2 : RefreshCw"
                :class="['size-4', diagnosticsLoading ? 'animate-spin' : '']"
              />
              {{ diagnosticsLoading ? 'Comprobando…' : 'Comprobar el sistema' }}
            </button>
          </div>
        </header>

        <p class="text-description mt-1">
          Verifica que el servidor puede generar PDF y vistas previas. Si Chrome falla, aquí
          verás la ruta y el motivo exacto.
        </p>

        <ul v-if="diagnostics.length > 0" class="mt-3 divide-y divide-hairline">
          <li v-for="check in diagnostics" :key="check.key" class="flex items-start gap-2.5 py-2.5">
            <CheckCircle2 v-if="check.ok" class="mt-0.5 size-4 shrink-0 text-success" />
            <XCircle v-else class="mt-0.5 size-4 shrink-0 text-danger" />
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium">{{ check.label }}</p>
              <p class="text-meta mt-0.5 break-words">{{ check.detail }}</p>
            </div>
          </li>
        </ul>
        <p v-if="diagnosticsAt" class="text-meta mt-2">
          Última comprobación: {{ new Date(diagnosticsAt).toLocaleString('es-PE') }}
        </p>
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
