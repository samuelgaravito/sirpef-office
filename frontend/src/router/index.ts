import { createRouter, createWebHistory } from 'vue-router';

import type { MenuKey } from '@sirpefoffice/shared';

import { canonicalRoutePath, normalizeRouteId } from '@/lib/routes';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: 'Entrar' },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { title: 'Inicio' },
    },
    {
      path: '/inbox',
      name: 'inbox',
      component: () => import('@/views/InboxView.vue'),
      meta: { title: 'Bandeja', menu: 'inbox' },
    },
    {
      path: '/inbox/:id',
      name: 'inbox-message',
      component: () => import('@/views/InboxMessageView.vue'),
      meta: { title: 'Mensaje', menu: 'inbox' },
    },
    {
      path: '/documents',
      name: 'documents',
      component: () => import('@/views/DocumentsView.vue'),
      meta: { title: 'Documentos', menu: 'documents' },
    },
    {
      path: '/documents/:id',
      name: 'document',
      component: () => import('@/views/DocumentEditorView.vue'),
      meta: { title: 'Editor', fullscreen: true, menu: 'documents' },
    },
    {
      path: '/templates',
      name: 'templates',
      component: () => import('@/views/TemplatesView.vue'),
      meta: { title: 'Plantillas', menu: 'templates' },
    },
    {
      path: '/templates/new',
      name: 'template-new',
      component: () => import('@/views/TemplateEditorView.vue'),
      meta: { title: 'Nueva plantilla', menu: 'templates' },
    },
    {
      path: '/templates/:id',
      name: 'template',
      component: () => import('@/views/TemplateEditorView.vue'),
      meta: { title: 'Plantilla', menu: 'templates' },
    },
    {
      path: '/designs',
      name: 'designs',
      component: () => import('@/views/DesignsView.vue'),
      meta: { title: 'Diseños', menu: 'designs' },
    },
    {
      path: '/designs/:id',
      name: 'design',
      component: () => import('@/views/DesignEditorView.vue'),
      meta: { title: 'Diseño', menu: 'designs' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: 'Ajustes' },
    },
    {
      path: '/settings/users',
      name: 'settings-users',
      component: () => import('@/views/UsersMenusView.vue'),
      meta: { title: 'Usuarios y menús', adminOnly: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: 'No encontrado' },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

/** Rutas de listado a las que vuelve un editor cuyo ID no es válido. */
const LIST_ROUTE_FOR_EDITOR: Record<string, string> = {
  document: 'documents',
  template: 'templates',
  design: 'designs',
  'inbox-message': 'inbox',
};

// Normaliza la URL antes de resolver la ruta: barras finales/repetidas y
// parámetros `undefined`, `null`, vacíos, etc. deben terminar en la vista
// canónica (lista o editor) en lugar de dejar montado un editor inválido.
router.beforeEach((to) => {
  const path = canonicalRoutePath(to.path);
  if (path !== to.path) {
    return { path, query: to.query, hash: to.hash, replace: true };
  }

  const fallback =
    typeof to.name === 'string' ? LIST_ROUTE_FOR_EDITOR[to.name] : undefined;
  if (fallback && !normalizeRouteId(to.params.id)) {
    return { name: fallback, query: to.query, hash: to.hash, replace: true };
  }

  return true;
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  await auth.fetchAuthConfig();
  if (!auth.initialized) await auth.fetchMe();

  if (to.meta.public) {
    if (auth.isAuthenticated) return { name: 'home' };
    return true;
  }

  if (!auth.isAuthenticated) {
    const renewed = await auth.refresh();
    if (!renewed) {
      // El login (local o por SVA) se resuelve en /login. En modo SVA esa
      // vista muestra el loader "Iniciando sesión" y canjea la cookie.
      return { name: 'login', query: { redirect: to.fullPath } };
    }
  }

  if (to.meta.adminOnly && !auth.isAdmin) return { name: 'home' };

  const requiredMenu = typeof to.meta.menu === 'string' ? (to.meta.menu as MenuKey) : null;
  if (requiredMenu && !auth.canSeeMenu(requiredMenu)) return { name: 'home' };

  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : 'Documentos';
  document.title = `${title} · SirpefOffice`;
});

export default router;
