import { buildApp } from './app.js';
import { env } from './env.js';
import { sql } from './db/index.js';
import { startSvaSyncScheduler, stopSvaSyncScheduler } from './lib/sva-sync.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando…`);
    stopSvaSyncScheduler();
    try {
      await app.close();
      await sql.end({ timeout: 5 });
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    // Comprueba la conexión antes de aceptar peticiones
    await sql`select 1`;
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`API disponible en http://localhost:${env.PORT}/api`);
    startSvaSyncScheduler(app.log);
  } catch (error) {
    app.log.error(error, 'No se pudo iniciar el servidor');
    process.exit(1);
  }
}

void main();
