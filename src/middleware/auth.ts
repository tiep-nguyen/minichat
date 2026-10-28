import type { RequestHandler } from 'express';
import { verifyApiKey, verifyJwt } from '../services/authService';
import { AppError, ErrorCode } from '../types';

/**
 * Ověří API klíč a volitelně JWT token.
 * Přidá req.tenant a nastaví CORS hlavičky dle tenant.allowed_origins.
 *
 * Analogie Nuxt route middleware — spustí se před každým route handlerem.
 */
export const authenticateTenant: RequestHandler = async (req, res, next) => {
  const rawKey = req.headers['x-api-key'];

  if (!rawKey || typeof rawKey !== 'string') {
    const err: AppError = {
      code: ErrorCode.INVALID_API_KEY,
      message: 'Chybí X-Api-Key hlavička',
      statusCode: 401,
    };
    res.status(401).json({ error: err });
    return;
  }

  const tenantResult = await verifyApiKey(rawKey);

  if (!tenantResult.success) {
    res.status(tenantResult.error.statusCode).json({ error: tenantResult.error });
    return;
  }

  const tenant = tenantResult.data;

  // ── CORS per-tenant ─────────────────────────────────────────────────────────
  // Global CORS je v app.ts vypnutý — zde nastavujeme origin dle whitelist tenanta
  const origin = req.headers.origin;
  if (origin && tenant.allowed_origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  // ── Preflight ────────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  // ── Volitelné JWT ────────────────────────────────────────────────────────────
  if (tenant.require_auth) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      const err: AppError = {
        code: ErrorCode.INVALID_JWT,
        message: 'Tenant vyžaduje JWT autentizaci (Authorization: Bearer <token>)',
        statusCode: 401,
      };
      res.status(401).json({ error: err });
      return;
    }

    const token = authHeader.slice(7);
    const jwtResult = verifyJwt(token);

    if (!jwtResult.success) {
      res.status(jwtResult.error.statusCode).json({ error: jwtResult.error });
      return;
    }
  }

  req.tenant = tenant;
  next();
};
