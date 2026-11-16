/**
 * Encargo pendiente que viaja del panel de trabajo al editor.
 *
 * El texto no se pone en la URL: se guarda en `sessionStorage` bajo el
 * identificador de la conversación (`chat`) y el editor lo consume una sola
 * vez al montarse. Así el historial del navegador no conserva lo que la
 * persona escribió ni se reenvía al recargar.
 */
const PREFIX = 'sirpef:ai-prompt:';

export function stashAiPrompt(chatId: string, prompt: string): void {
  const text = prompt.trim();
  if (!chatId || !text) return;
  try {
    window.sessionStorage.setItem(`${PREFIX}${chatId}`, text);
  } catch {
    // Sin almacenamiento: el asistente se abrirá vacío, sin romper el flujo.
  }
}

/** Devuelve el encargo y lo borra: solo se envía una vez. */
export function takeAiPrompt(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  const key = `${PREFIX}${chatId}`;
  try {
    const text = window.sessionStorage.getItem(key);
    if (text === null) return null;
    window.sessionStorage.removeItem(key);
    return text.trim() || null;
  } catch {
    return null;
  }
}
