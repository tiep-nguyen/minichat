import bcrypt from 'bcrypt';
import { pool } from '../db/pool';
import { decrypt } from './cryptoService';
import { env } from '../config/env';
import { Result, ErrorCode, Tenant, TenantRuntime } from '../types';

// ─── In-memory cache (analogie Pinia store s TTL) ─────────────────────────────

interface CacheEntry {
  tenant: TenantRuntime;
  expiresAt: number;
}

// Dva indexy pro rychlé vyhledávání: dle raw API klíče i dle UUID
const cacheByApiKey = new Map<string, CacheEntry>();
const cacheById     = new Map<string, CacheEntry>();

const ttlMs = () => env.TENANT_CACHE_TTL * 1000;

function fromCache<K>(map: Map<K, CacheEntry>, key: K): TenantRuntime | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.tenant;
}

function toCache(apiKey: string, tenant: TenantRuntime): void {
  const entry: CacheEntry = { tenant, expiresAt: Date.now() + ttlMs() };
  cacheByApiKey.set(apiKey, entry);
  cacheById.set(tenant.id, entry);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRuntime(row: Tenant, webhookUrl: string, hmacSecret: string): TenantRuntime {
  return {
    id: row.id,
    name: row.name,
    teams_webhook_url: webhookUrl,
    teams_hmac_secret: hmacSecret,
    require_auth: row.require_auth,
    rate_limit_per_minute: row.rate_limit_per_minute,
    allowed_origins: row.allowed_origins,
  };
}

async function decryptTenant(row: Tenant): Promise<Result<TenantRuntime>> {
  const urlResult    = decrypt(row.teams_webhook_url_enc);
  const secretResult = decrypt(row.teams_hmac_secret_enc);

  if (!urlResult.success) return urlResult;
  if (!secretResult.success) return secretResult;

  return { success: true, data: buildRuntime(row, urlResult.data, secretResult.data) };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Najde tenanta dle raw API klíče.
 * Prohledá in-memory cache (TTL 60s), při miss scanuje DB a porovnává bcrypt hashes.
 *
 * @param apiKey - Hodnota z X-Api-Key hlavičky (raw, nezahashovaná)
 * @returns Result<TenantRuntime> — decrypted runtime config nebo chyba
 */
export async function getTenantByApiKey(apiKey: string): Promise<Result<TenantRuntime>> {
  const cached = fromCache(cacheByApiKey, apiKey);
  if (cached) return { success: true, data: cached };

  let rows: Tenant[];
  try {
    const { rows: dbRows } = await pool.query<Tenant>(
      `SELECT id, name, api_key_hash, teams_webhook_url_enc, teams_hmac_secret_enc,
              require_auth, rate_limit_per_minute, allowed_origins, created_at, updated_at
       FROM tenants`,
    );
    rows = dbRows;
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při načítání tenantů', statusCode: 500 },
    };
  }

  for (const row of rows) {
    const match = await bcrypt.compare(apiKey, row.api_key_hash);
    if (!match) continue;

    const runtimeResult = await decryptTenant(row);
    if (!runtimeResult.success) return runtimeResult;

    toCache(apiKey, runtimeResult.data);
    return runtimeResult;
  }

  return {
    success: false,
    error: { code: ErrorCode.INVALID_API_KEY, message: 'Neplatný API klíč', statusCode: 401 },
  };
}

/**
 * Najde tenanta dle UUID (používá se ve webhook endpointu kde není API klíč).
 * Cache sdílí s getTenantByApiKey.
 *
 * @param tenantId - UUID tenanta z URL parametru
 * @returns Result<TenantRuntime>
 */
export async function getTenantById(tenantId: string): Promise<Result<TenantRuntime>> {
  const cached = fromCache(cacheById, tenantId);
  if (cached) return { success: true, data: cached };

  let row: Tenant | undefined;
  try {
    const { rows } = await pool.query<Tenant>(
      `SELECT id, name, api_key_hash, teams_webhook_url_enc, teams_hmac_secret_enc,
              require_auth, rate_limit_per_minute, allowed_origins, created_at, updated_at
       FROM tenants WHERE id = $1`,
      [tenantId],
    );
    row = rows[0];
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při načítání tenanta', statusCode: 500 },
    };
  }

  if (!row) {
    return {
      success: false,
      error: { code: ErrorCode.TENANT_NOT_FOUND, message: 'Tenant nenalezen', statusCode: 404 },
    };
  }

  const runtimeResult = await decryptTenant(row);
  if (!runtimeResult.success) return runtimeResult;

  // Uložíme do ID cache (bez API klíče — ten tu neznáme)
  cacheById.set(tenantId, { tenant: runtimeResult.data, expiresAt: Date.now() + ttlMs() });
  return runtimeResult;
}

/**
 * Invaliduje cache záznamy pro daný API klíč.
 * Volat po aktualizaci tenant konfigurace.
 *
 * @param apiKey - Raw API klíč jehož cache se má smazat
 */
export function invalidateTenantCache(apiKey: string): void {
  const entry = cacheByApiKey.get(apiKey);
  if (entry) {
    cacheById.delete(entry.tenant.id);
    cacheByApiKey.delete(apiKey);
  }
}
