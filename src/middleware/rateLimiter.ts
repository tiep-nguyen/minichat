import type { RequestHandler } from 'express';
import { AppError, ErrorCode } from '../types';

// Sliding window rate limiter — per tenant, in-memory
// Analogie composable useRateLimit — stav izolovaný per-tenant ID

interface WindowEntry {
  timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

const WINDOW_MS = 60_000; // 1 minuta

/**
 * Per-tenant sliding window rate limiter.
 * Limit se načítá z req.tenant.rate_limit_per_minute (nastaveno v DB).
 * Musí být aplikován AŽ PO authenticateTenant middleware.
 */
export const tenantRateLimiter: RequestHandler = (req, res, next) => {
  const tenant = req.tenant;

  if (!tenant) {
    next();
    return;
  }

  const key = tenant.id;
  const now = Date.now();
  const limit = tenant.rate_limit_per_minute;

  // Získat nebo inicializovat okno
  let entry = windows.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(key, entry);
  }

  // Vyčistit záznamy starší než 1 minuta (sliding window)
  entry.timestamps = entry.timestamps.filter(t => now - t < WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);

    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');

    const err: AppError = {
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: `Rate limit překročen — max ${limit} zpráv/minutu`,
      statusCode: 429,
    };

    res.status(429).json({ error: err });
    return;
  }

  entry.timestamps.push(now);

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(limit - entry.timestamps.length));

  next();
};
