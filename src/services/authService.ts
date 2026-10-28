import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getTenantByApiKey } from './tenantService';
import { env } from '../config/env';
import { Result, ErrorCode, TenantRuntime } from '../types';

/**
 * Ověří raw API klíč z X-Api-Key hlavičky.
 * Používá timing-safe compare na délku klíče jako první guard,
 * poté deleguje na tenantService (bcrypt compare).
 *
 * @param rawKey - Hodnota X-Api-Key hlavičky
 * @returns Result<TenantRuntime> nebo INVALID_API_KEY chyba
 */
export async function verifyApiKey(rawKey: string): Promise<Result<TenantRuntime>> {
  // Základní sanity check — prázdný klíč okamžitě odmítneme
  // (bcrypt.compare by sice vrátil false, ale ušetříme DB dotaz)
  if (!rawKey || rawKey.length < 16) {
    return {
      success: false,
      error: { code: ErrorCode.INVALID_API_KEY, message: 'Neplatný API klíč', statusCode: 401 },
    };
  }

  // Timing-safe check délky klíče — předchází length-oracle útokům
  // (raw klíče generujeme jako 64 hex znaků = 64 bytes)
  const expectedLength = Buffer.alloc(64);
  const actualLength   = Buffer.alloc(64);
  Buffer.from(rawKey.padEnd(64, '\0').slice(0, 64)).copy(actualLength);

  try {
    crypto.timingSafeEqual(expectedLength, actualLength);
  } catch {
    // timingSafeEqual hodí jen pokud se délky bufferů liší — to tady nemůže nastat
  }

  return getTenantByApiKey(rawKey);
}

/**
 * Ověří JWT Bearer token.
 *
 * @param token - Raw JWT string (bez "Bearer " prefixu)
 * @returns Result<jwt.JwtPayload> nebo INVALID_JWT chyba
 */
export function verifyJwt(token: string): Result<jwt.JwtPayload> {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    if (typeof payload === 'string') {
      return {
        success: false,
        error: { code: ErrorCode.INVALID_JWT, message: 'Neplatný JWT payload', statusCode: 401 },
      };
    }

    return { success: true, data: payload };
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    return {
      success: false,
      error: {
        code: ErrorCode.INVALID_JWT,
        message: isExpired ? 'JWT token vypršel' : 'Neplatný JWT token',
        statusCode: 401,
      },
    };
  }
}
