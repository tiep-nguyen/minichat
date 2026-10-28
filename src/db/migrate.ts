import fs from 'fs';
import path from 'path';
import { pool } from './pool';

/**
 * Spustí všechny neaplikované SQL migrace v pořadí.
 * Každá migrace se spouští v transakci — při chybě se celá rollbackuje.
 */
async function migrate(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // alfabetické řazení = číselné pořadí při prefixu 001_, 002_...

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE filename = $1',
        [file],
      );

      if (rows.length > 0) {
        console.log(`[migrate] Přeskočeno: ${file} (již aplikováno)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');

      console.log(`[migrate] Aplikováno: ${file}`);
    }

    console.log('[migrate] Hotovo.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('[migrate] Selhalo:', (err as Error).message);
  process.exit(1);
});
