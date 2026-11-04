/**
 * Utilidades de navegación hacia el portal SVA.
 */

const RAW_SVA_URL = (import.meta.env.VITE_SVA_URL ?? '').toString().trim();
const RAW_SVA_API_URL = (import.meta.env.VITE_SVA_API_URL ?? '').toString().trim();

export const svaUrl = RAW_SVA_URL.replace(/\/+$/, '');

/** API de SVA. Si no se define, se asume el mismo origen que el portal. */
export const svaApiUrl = (RAW_SVA_API_URL || RAW_SVA_URL).replace(/\/+$/, '');

/** URL de login de SVA. */
export function svaLoginUrl(): string {
  return svaUrl ? `${svaUrl}/login` : '';
}

/** Panel de gestión de usuarios del portal SVA (solo administradores). */
export function svaUsersUrl(): string {
  return svaUrl ? `${svaUrl}/users` : '';
}

export function redirectToSvaLogin(): void {
  const url = svaLoginUrl();
  if (url) window.location.assign(url);
}

/**
 * Cierra también la sesión del portal SVA. Sin esto, al volver al portal
 * se reabriría la sesión de SirpefOffice de inmediato.
 */
export async function logoutFromSva(): Promise<void> {
  if (!svaApiUrl) return;
  try {
    await fetch(`${svaApiUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Si SVA no responde, el cierre local ya se hizo.
  }
}
