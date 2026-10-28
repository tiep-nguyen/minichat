/**
 * Seed skript — vytvoří prvního tenanta v DB.
 * Spouštět pouze jednou: npm run seed
 *
 * Raw API klíč se zobrazí POUZE při tomto spuštění — uložte si ho bezpečně.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import * as readline from 'readline/promises';
import { pool } from './pool';
import { encrypt } from '../services/cryptoService';
import { BCRYPT_ROUNDS } from '../config/constants';

async function seed(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\n=== MiniChat Seed — Vytvoření prvního tenanta ===\n');

    const name            = await rl.question('Název tenanta: ');
    const teamsWebhookUrl = await rl.question('MS Teams Incoming Webhook URL (Power Automate): ');
    const teamsHmacSecret = await rl.question('MS Teams Security token (z Outgoing Webhook → Apps → Manage team): ');
    const requireAuth     = (await rl.question('Vyžadovat JWT autentizaci? (ano/ne): ')).toLowerCase() === 'ano';
    const rateLimit       = parseInt(await rl.question('Rate limit (zpráv/min, výchozí 60): ') || '60', 10);
    const originsInput    = await rl.question('Povolené CORS origins (čárkou oddělené, nebo prázdné): ');

    rl.close();

    const allowedOrigins = originsInput
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);

    // Generovat raw API klíč
    const rawApiKey = crypto.randomBytes(32).toString('hex');

    console.log('\n[seed] Hashování API klíče (bcrypt)...');
    const apiKeyHash = await bcrypt.hash(rawApiKey, BCRYPT_ROUNDS);

    // Šifrovat Teams secrets
    const webhookResult = encrypt(teamsWebhookUrl);
    const hmacResult    = encrypt(teamsHmacSecret);

    if (!webhookResult.success) throw new Error('Šifrování Webhook URL selhalo: ' + webhookResult.error.message);
    if (!hmacResult.success)    throw new Error('Šifrování HMAC secret selhalo: ' + hmacResult.error.message);

    const { rows } = await pool.query(
      `INSERT INTO tenants
         (name, api_key_hash, teams_webhook_url_enc, teams_hmac_secret_enc,
          require_auth, rate_limit_per_minute, allowed_origins)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        name,
        apiKeyHash,
        webhookResult.data,
        hmacResult.data,
        requireAuth,
        rateLimit,
        allowedOrigins,
      ],
    );

    console.log('\n✓ Tenant vytvořen');
    console.log(`  ID:   ${rows[0].id}`);
    console.log(`  Jméno: ${name}`);
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  API KLÍČ (uložte si ho — zobrazí se jen jednou!):');
    console.log(`  ${rawApiKey}`);
    console.log('══════════════════════════════════════════════════════════\n');

    console.log('Použití:');
    console.log(`  curl -H "X-Api-Key: ${rawApiKey}" \\`);
    console.log(`       -H "Content-Type: application/json" \\`);
    console.log(`       -d '{"external_user_id":"user1","content":"Ahoj!"}' \\`);
    console.log('       http://localhost:3000/api/v1/chat/message\n');
  } finally {
    rl.close();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('[seed] Selhalo:', (err as Error).message);
  process.exit(1);
});
