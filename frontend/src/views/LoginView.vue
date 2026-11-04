<script setup lang="ts">
import {
  ArrowRight,
  Check,
  FileText,
  LayoutTemplate,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError } from '@/api/client';
import { svaLoginUrl, svaUrl } from '@/lib/sva';
import { useAuthStore, type AuthMode } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const authMode = ref<AuthMode>('local');
const checkingSva = ref(true);
const mode = ref<'login' | 'register'>('login');
const email = ref('admin@sirpefoffice.local');
const password = ref('sirpefoffice');
const name = ref('');
const error = ref('');
const submitting = ref(false);

const isRegister = computed(() => mode.value === 'register');
const canRegister = computed(() => authMode.value === 'local');
const usesSva = computed(() => authMode.value !== 'local');
const redirect = computed(() =>
  typeof route.query.redirect === 'string' ? route.query.redirect : '/',
);

const features = [
  { icon: LayoutTemplate, text: 'Plantillas reutilizables con diseños editables' },
  { icon: FileText, text: 'Numeración correlativa y campos automáticos' },
  { icon: Sparkles, text: 'Redacción asistida con el proveedor de IA que elijas' },
];

async function finish(): Promise<void> {
  await router.replace(redirect.value);
}

async function init(): Promise<void> {
  authMode.value = await auth.fetchAuthConfig();

  if (authMode.value === 'local') {
    checkingSva.value = false;
    return;
  }

  // SVA manda: si ya hay sesión en el portal, se canjea sin pedir nada.
  checkingSva.value = true;
  const ok = await auth.loginWithSva();
  checkingSva.value = false;

  if (ok) {
    await finish();
    return;
  }

  if (authMode.value === 'sva') {
    if (svaUrl) {
      window.location.replace(svaLoginUrl());
      return;
    }
    error.value =
      'No hay una sesión SVA válida. Configura VITE_SVA_URL o inicia sesión en el portal SVA.';
    return;
  }

  // Híbrido: se conserva el acceso local de emergencia.
  error.value =
    'No encontramos una sesión SVA válida. Puedes entrar con la cuenta local de emergencia.';
}

onMounted(() => void init());

function switchMode(): void {
  mode.value = isRegister.value ? 'login' : 'register';
  error.value = '';
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  error.value = '';
  submitting.value = true;

  try {
    if (isRegister.value) {
      if (!name.value.trim()) {
        error.value = 'Escribe tu nombre';
        return;
      }
      await auth.register(email.value.trim(), name.value.trim(), password.value);
    } else {
      await auth.login(email.value.trim(), password.value);
    }

    await finish();
  } catch (caught) {
    if (caught instanceof ApiError) {
      error.value = caught.message;
    } else {
      error.value = 'No se pudo conectar con el servidor';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
    <!-- Panel de marca -->
    <section class="relative hidden flex-col justify-between overflow-hidden bg-[#0e1726] p-12 text-white lg:flex">
      <div
        class="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full opacity-40 blur-3xl"
        style="background: radial-gradient(circle, #2563eb 0%, transparent 70%)"
      />
      <div
        class="pointer-events-none absolute -bottom-32 -left-20 size-[380px] rounded-full opacity-25 blur-3xl"
        style="background: radial-gradient(circle, #0ea5a4 0%, transparent 70%)"
      />

      <div class="relative">
        <div class="flex items-center gap-2.5">
          <span class="grid size-8 place-items-center rounded-lg bg-accent text-sm font-black">W</span>
          <span class="text-[17px] font-semibold tracking-tight">SirpefOffice</span>
        </div>

        <h1 class="mt-16 max-w-md text-[38px] font-semibold leading-[1.15] tracking-tight">
          Documentos institucionales,<br />
          <span class="text-[#8fb4ff]">sin pelear con el formato.</span>
        </h1>
        <p class="mt-4 max-w-md text-[14.5px] leading-relaxed text-white/65">
          Memorándums, notas de entrega, informes y actas con plantillas reutilizables,
          numeración automática e historial de versiones.
        </p>

        <ul class="mt-10 space-y-3.5">
          <li v-for="feature in features" :key="feature.text" class="flex items-center gap-3 text-[13.5px] text-white/80">
            <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-white/10">
              <component :is="feature.icon" class="size-3.5 text-[#8fb4ff]" />
            </span>
            {{ feature.text }}
          </li>
        </ul>
      </div>

      <div class="relative flex items-center gap-2 text-[12px] text-white/40">
        <Check class="size-3.5" />
        Exportación a PDF, DOCX y HTML · Historial de versiones · Multiusuario
      </div>
    </section>

    <!-- Formulario -->
    <section class="flex items-center justify-center bg-canvas px-5 py-12">
      <div class="w-full max-w-[380px]">
        <div class="mb-8 flex items-center gap-2.5 lg:hidden">
          <span class="grid size-8 place-items-center rounded-lg bg-accent text-sm font-black text-white">W</span>
          <span class="text-[16px] font-semibold">SirpefOffice</span>
        </div>

        <!-- Validando la sesión del portal SVA -->
        <div v-if="checkingSva" class="mt-10 flex flex-col items-center text-center">
          <Loader2 class="size-8 animate-spin text-accent" />
          <h2 class="mt-5 text-[22px] font-semibold tracking-tight">Iniciando sesión</h2>
          <p class="mt-2 text-[13px] text-ink-muted">
            Validando tu acceso con SVA. No necesitas escribir nada.
          </p>
        </div>

        <!-- Modo SVA puro: sin formulario local -->
        <div v-else-if="authMode === 'sva'" class="mt-10">
          <span class="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
            <ShieldCheck class="size-5" />
          </span>
          <h2 class="mt-4 text-[22px] font-semibold tracking-tight">Entra desde SVA</h2>
          <p class="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Los usuarios y permisos se administran en SVA. Inicia sesión en el portal y
            vuelve a SirpefOffice; tu cuenta se crea automáticamente.
          </p>

          <p
            v-if="error"
            class="mt-5 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
          >
            {{ error }}
          </p>

          <a v-if="svaUrl" :href="svaLoginUrl()" class="btn btn-primary mt-6 w-full">
            Ir al portal SVA
            <ArrowRight class="size-4" />
          </a>
          <button v-else type="button" class="btn btn-primary mt-6 w-full" @click="init">
            Reintentar
          </button>
        </div>

        <!-- Modo local o híbrido (break-glass) -->
        <template v-else>
          <h2 class="text-[24px] font-semibold tracking-tight">
            {{ isRegister ? 'Crear cuenta' : 'Acceso de emergencia' }}
          </h2>
          <p class="mt-1.5 text-[13px] text-ink-muted">
            {{
              isRegister
                ? 'Tu cuenta se creará como miembro del equipo.'
                : usesSva
                  ? 'La cuenta SVA no está disponible en este navegador. Usa la cuenta local de emergencia.'
                  : 'Entra para continuar con tus documentos.'
            }}
          </p>

          <form class="mt-7 space-y-4" @submit.prevent="submit">
            <div v-if="isRegister">
              <label class="label" for="name">Nombre completo</label>
              <input id="name" v-model="name" class="field" autocomplete="name" placeholder="Ana Torres" />
            </div>

            <div>
              <label class="label" for="email">Correo electrónico</label>
              <input
                id="email"
                v-model="email"
                class="field"
                type="email"
                autocomplete="email"
                required
                placeholder="tu@institucion.gob.pe"
              />
            </div>

            <div>
              <label class="label" for="password">Contraseña</label>
              <input
                id="password"
                v-model="password"
                class="field"
                type="password"
                :autocomplete="isRegister ? 'new-password' : 'current-password'"
                required
                placeholder="••••••••"
              />
              <p v-if="isRegister" class="mt-1.5 text-[11.5px] text-ink-subtle">Mínimo 8 caracteres.</p>
            </div>

            <p
              v-if="error"
              class="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
            >
              {{ error }}
            </p>

            <button type="submit" class="btn btn-primary w-full" :disabled="submitting || auth.loading">
              {{ submitting ? 'Comprobando…' : isRegister ? 'Crear cuenta' : 'Entrar' }}
              <ArrowRight v-if="!submitting" class="size-4" />
            </button>
          </form>

          <p v-if="canRegister" class="mt-5 text-center text-[12.5px] text-ink-muted">
            {{ isRegister ? '¿Ya tienes cuenta?' : '¿Aún no tienes cuenta?' }}
            <button type="button" class="font-medium text-accent hover:underline" @click="switchMode">
              {{ isRegister ? 'Inicia sesión' : 'Regístrate' }}
            </button>
          </p>

          <a v-if="usesSva && svaUrl" :href="svaLoginUrl()"
            class="mt-4 block text-center text-[12.5px] font-medium text-accent hover:underline">
            Volver al portal SVA
          </a>

          <div v-if="!isRegister && !usesSva" class="mt-8 rounded-xl border border-hairline bg-surface/70 px-4 py-3">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Cuenta de demostración</p>
            <p class="mt-1 font-mono text-[12px] text-ink-muted">admin@sirpefoffice.local · sirpefoffice</p>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
