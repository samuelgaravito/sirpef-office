/**
 * Comprueba el camino completo del canal de eventos en tiempo real tal y como
 * lo recorre el navegador: login (que deja la cookie de sesión) → handshake
 * del WebSocket por el mismo origen → saludo del servidor.
 *
 *   node scripts/realtime-proxy-smoke.mjs [http://localhost:5173]
 *
 * Necesita la web de desarrollo levantada (el proxy de Vite) o, en
 * producción, la URL pública. Es la comprobación rápida de que el proxy deja
 * pasar el *upgrade* del WebSocket y de que la cookie llega al handshake.
 *
 * Variables opcionales: ADMIN_EMAIL y ADMIN_PASSWORD (por defecto, el
 * administrador del seed).
 */
import { WebSocket } from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@sirpefoffice.local';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'sirpefoffice';

function assert(condition, message) {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!login.ok) {
    throw new Error(`✖ El login falló (${login.status}): ${await login.text()}`);
  }

  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .find((value) => value.startsWith('sd_access='));

  assert(Boolean(cookie), 'El login deja la cookie de sesión');

  const url = `${BASE.replace(/^http/, 'ws')}/api/ws`;
  const socket = new WebSocket(url, { headers: { cookie } });

  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('✖ El canal no respondió a tiempo')),
      8000,
    );
    socket.on('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`✖ No se pudo abrir el canal: ${error.message}`));
    });
    socket.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`✖ El canal se cerró con el código ${code}`));
    });
  });

  assert(message.type === 'connection.ready', 'El servidor saluda por el canal');

  socket.close();
  console.log('\n✔ Tiempo real por el proxy: todo correcto');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
