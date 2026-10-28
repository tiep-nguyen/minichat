/** Maximální stáří Teams Outgoing Webhook requestu (ochrana před replay útokem) */
export const HMAC_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** Interval ping zpráv pro SSE spojení */
export const SSE_PING_INTERVAL_MS = 30_000;

/** Maximální doba trvání SSE spojení */
export const SSE_MAX_DURATION_MS = 5 * 60_000;

export const BCRYPT_ROUNDS = 12;

export const AES_ALGORITHM = 'aes-256-gcm' as const;

/** Délka IV pro AES-256-GCM v bytech */
export const AES_IV_BYTES = 12;

/** Délka autentizačního tagu pro AES-256-GCM v bytech */
export const AES_TAG_BYTES = 16;
