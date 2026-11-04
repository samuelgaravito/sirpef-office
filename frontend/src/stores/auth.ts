import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { AuthResponse, MenuKey, PublicUser } from '@sirpefoffice/shared';

import { api, setAccessToken } from '@/api/client';

const STORAGE_KEY = 'sirpefoffice.token';

export type AuthMode = 'local' | 'hybrid' | 'sva';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null);
  const token = ref<string | null>(localStorage.getItem(STORAGE_KEY));
  const loading = ref(false);
  const initialized = ref(false);
  const authMode = ref<AuthMode>('local');
  const authModeLoaded = ref(false);

  if (token.value) setAccessToken(token.value);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.role === 'admin');
  const menus = computed<MenuKey[]>(() => user.value?.menus ?? ['home']);
  const canSeeMenu = (key: MenuKey): boolean => menus.value.includes(key);
  const initials = computed(() => {
    const name = user.value?.name ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  function applySession(data: AuthResponse): void {
    user.value = data.user;
    token.value = data.accessToken;
    localStorage.setItem(STORAGE_KEY, data.accessToken);
    setAccessToken(data.accessToken);
  }

  /** Lee el modo de autenticación del backend (público). */
  async function fetchAuthConfig(): Promise<AuthMode> {
    if (authModeLoaded.value) return authMode.value;
    try {
      const data = await api.get<{ authMode: AuthMode }>('/auth/config');
      authMode.value = data.authMode;
    } catch {
      authMode.value = 'local';
    } finally {
      authModeLoaded.value = true;
    }
    return authMode.value;
  }

  /**
   * Canjea la cookie de SVA por una sesión local. El backend materializa el
   * usuario automáticamente; aquí no se registra ni se crea nada.
   */
  async function loginWithSva(): Promise<boolean> {
    loading.value = true;
    try {
      const data = await api.post<AuthResponse>('/auth/sva');
      applySession(data);
      return true;
    } catch {
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    loading.value = true;
    try {
      const data = await api.post<AuthResponse>('/auth/login', { email, password });
      applySession(data);
    } finally {
      loading.value = false;
    }
  }

  async function register(email: string, name: string, password: string): Promise<void> {
    loading.value = true;
    try {
      const data = await api.post<AuthResponse>('/auth/register', { email, name, password });
      applySession(data);
    } finally {
      loading.value = false;
    }
  }

  async function fetchMe(): Promise<void> {
    try {
      const data = await api.get<{ user: PublicUser }>('/auth/me');
      user.value = data.user;
    } catch {
      user.value = null;
      token.value = null;
      localStorage.removeItem(STORAGE_KEY);
      setAccessToken(null);
    } finally {
      initialized.value = true;
    }
  }

  /** Intenta renovar la sesión con la cookie de refresco. */
  async function refresh(): Promise<boolean> {
    try {
      const data = await api.post<AuthResponse>('/auth/refresh');
      applySession(data);
      return true;
    } catch {
      return false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      user.value = null;
      token.value = null;
      localStorage.removeItem(STORAGE_KEY);
      setAccessToken(null);
    }
  }

  return {
    user,
    token,
    loading,
    initialized,
    authMode,
    authModeLoaded,
    isAuthenticated,
    isAdmin,
    menus,
    canSeeMenu,
    initials,
    fetchAuthConfig,
    loginWithSva,
    login,
    register,
    fetchMe,
    refresh,
    logout,
  };
});
