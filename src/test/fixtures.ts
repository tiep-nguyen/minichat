import crypto from 'crypto';
import type { TenantRuntime, Message, Conversation } from '../types';

export function createMockTenant(overrides: Partial<TenantRuntime> = {}): TenantRuntime {
  return {
    id: 'tenant-uuid-1234-5678-90ab-cdef01234567',
    name: 'Test Tenant',
    teams_webhook_url: 'https://prod-xx.logic.azure.com/workflows/test',
    teams_hmac_secret: Buffer.from('test-hmac-secret-32-bytes-minimum!').toString('base64'),
    require_auth: false,
    rate_limit_per_minute: 60,
    allowed_origins: ['http://localhost:3000'],
    ...overrides,
  };
}

export function signHmac(secretBase64: string, rawBody: Buffer | string): string {
  const secretBytes = Buffer.from(secretBase64, 'base64');
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return crypto.createHmac('sha256', secretBytes).update(body).digest('base64');
}

/**
 * Vytvoří mock Conversation pro testy.
 */
export function createMockConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-uuid-1234-5678-90ab-cdef01234567',
    tenant_id: 'tenant-uuid-1234-5678-90ab-cdef01234567',
    external_user_id: 'user-123',
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Vytvoří mock Message pro testy.
 */
export function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-uuid-1234-5678-90ab-cdef01234567',
    conversation_id: 'conv-uuid-1234-5678-90ab-cdef01234567',
    direction: 'inbound',
    content: 'Testovací zpráva',
    status: 'pending',
    teams_message_id: null,
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

