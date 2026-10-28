import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Logujeme jen kód chyby, ne connection string (obsahuje credentials)
  console.error('[db] Neočekávaná chyba pool:', { code: (err as NodeJS.ErrnoException).code });
});
