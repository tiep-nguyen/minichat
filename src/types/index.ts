import { z } from 'zod';

// ─── Tenant ──────────────────────────────────────────────────────────────────

/** Raw DB row — obsahuje šifrované bytea sloupce */
export interface Tenant {
  id: string;
  name: string;
  api_key_hash: string;
  teams_webhook_url_enc: Buffer;
  teams_hmac_secret_enc: Buffer;
  require_auth: boolean;
  rate_limit_per_minute: number;
  allowed_origins: string[];
  created_at: Date;
  updated_at: Date;
}

/** Decrypted runtime tenant — NIKDY neperzistovat ani nelogovat */
export interface TenantRuntime {
  id: string;
  name: string;
  teams_webhook_url: string;
  teams_hmac_secret: string;
  require_auth: boolean;
  rate_limit_per_minute: number;
  allowed_origins: string[];
}

// ─── Conversation ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  tenant_id: string;
  external_user_id: string;
  created_at: Date;
}

// ─── Message ──────────────────────────────────────────────────────────────────

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  content: string;
  status: MessageStatus;
  teams_message_id: string | null;
  created_at: Date;
}

// ─── Result pattern ───────────────────────────────────────────────────────────
// Analogie useAsyncData z Nuxt — explicitní success/error stavy bez throw everywhere

export type Result<T, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

export interface AppError {
  code: ErrorCode;
  message: string;
  statusCode: number;
}

export enum ErrorCode {
  INVALID_API_KEY        = 'INVALID_API_KEY',
  INVALID_JWT            = 'INVALID_JWT',
  TENANT_NOT_FOUND       = 'TENANT_NOT_FOUND',
  CONVERSATION_NOT_FOUND = 'CONVERSATION_NOT_FOUND',
  RATE_LIMIT_EXCEEDED    = 'RATE_LIMIT_EXCEEDED',
  INVALID_HMAC           = 'INVALID_HMAC',
  REPLAY_ATTACK          = 'REPLAY_ATTACK',
  TEAMS_DELIVERY_FAILED  = 'TEAMS_DELIVERY_FAILED',
  VALIDATION_ERROR       = 'VALIDATION_ERROR',
  DATABASE_ERROR         = 'DATABASE_ERROR',
  ENCRYPTION_ERROR       = 'ENCRYPTION_ERROR',
  INTERNAL_ERROR         = 'INTERNAL_ERROR',
}

// ─── Express Request rozšíření ────────────────────────────────────────────────
// Analogie Nuxt route middleware context

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantRuntime;
      rawBody?: Buffer;
    }
  }
}

// ─── Zod validační schémata ───────────────────────────────────────────────────

export const SendMessageSchema = z.object({
  external_user_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[\w\-@.]+$/, 'Povoleny jsou pouze písmena, číslice, -, @, .'),
  conversation_id: z.string().uuid().optional(),
  content: z
    .string()
    .min(1, 'Zpráva nemůže být prázdná')
    .max(4000, 'Zpráva přesahuje 4000 znaků')
    .refine(s => s.trim().length > 0, 'Zpráva nemůže obsahovat jen mezery'),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export const TeamsOutgoingWebhookSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
  text: z.string().optional(),
  value: z.record(z.unknown()).nullable().optional(),
});

export type TeamsWebhookPayload = z.infer<typeof TeamsOutgoingWebhookSchema>;

// ─── SSE ──────────────────────────────────────────────────────────────────────

export interface SseEvent {
  event: 'message' | 'error' | 'ping';
  data: unknown;
}

