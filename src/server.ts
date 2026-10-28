import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';

async function start(): Promise<void> {
  // Ověřit DB spojení před přijetím prvního requestu
  await pool.query('SELECT 1');
  console.log('[server] DB spojení ověřeno');

  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`[server] Naslouchám na portu ${env.PORT} (${env.NODE_ENV})`);
  });
}

start().catch(err => {
  console.error('[server] Start selhal:', (err as Error).message);
  process.exit(1);
});
