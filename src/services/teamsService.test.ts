import { describe, it, expect } from 'vitest';
import { verifyTeamsHmac, buildWorkflowPayload, extractReplyText } from './teamsService';
import { signHmac } from '../test/fixtures';

const SECRET_BASE64 = Buffer.from('test-hmac-secret-exactly-32bytes').toString('base64');

describe('teamsService — verifyTeamsHmac', () => {
  function makePayload(overrides: Partial<{ timestamp: string; text: string }> = {}) {
    return {
      type: 'message',
      timestamp: new Date().toISOString(),
      text: 'Testovací zpráva',
      ...overrides,
    };
  }

  it('přijme platný HMAC podpis', () => {
    const body = Buffer.from(JSON.stringify(makePayload()), 'utf8');
    const sig = signHmac(SECRET_BASE64, body);
    const payload = makePayload();

    const result = verifyTeamsHmac(SECRET_BASE64, `HMAC ${sig}`, body, payload.timestamp);
    expect(result.success).toBe(true);
  });

  it('odmítne zprávu starší než 5 minut (replay protection)', () => {
    const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const payload = makePayload({ timestamp: oldTimestamp });
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = signHmac(SECRET_BASE64, body);

    const result = verifyTeamsHmac(SECRET_BASE64, `HMAC ${sig}`, body, oldTimestamp);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: { code: string } }).error.code).toBe('REPLAY_ATTACK');
  });

  it('odmítne poškozené tělo (tampered body)', () => {
    const payload = makePayload();
    const originalBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = signHmac(SECRET_BASE64, originalBody);

    const tamperedBody = Buffer.from(JSON.stringify({ ...payload, text: 'jiný text' }), 'utf8');

    const result = verifyTeamsHmac(SECRET_BASE64, `HMAC ${sig}`, tamperedBody, payload.timestamp);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: { code: string } }).error.code).toBe('INVALID_HMAC');
  });

  it('odmítne chybějící HMAC prefix v Authorization hlavičce', () => {
    const payload = makePayload();
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    const result = verifyTeamsHmac(SECRET_BASE64, 'Bearer sometoken', body, payload.timestamp);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: { code: string } }).error.code).toBe('INVALID_HMAC');
  });

  it('odmítne prázdný Authorization header', () => {
    const payload = makePayload();
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    const result = verifyTeamsHmac(SECRET_BASE64, '', body, payload.timestamp);
    expect(result.success).toBe(false);
  });
});

describe('teamsService — buildWorkflowPayload', () => {
  it('sestaví Adaptive Card pro Workflows webhook', () => {
    const payload = buildWorkflowPayload('Ahoj světe!') as Record<string, unknown>;

    expect(payload.type).toBe('AdaptiveCard');
    expect(payload.version).toBe('1.4');
    const body = payload.body as Array<Record<string, unknown>>;
    expect(body[0].text).toBe('Ahoj světe!');
    expect(body[0].wrap).toBe(true);
  });
});

describe('teamsService — extractReplyText', () => {
  it('odstraní <at> mention tagy', () => {
    const result = extractReplyText('<at>MiniChat Bot</at> Tohle je odpověď');
    expect(result).toBe('Tohle je odpověď');
  });

  it('zachová text bez mention tagů', () => {
    expect(extractReplyText('Prostý text')).toBe('Prostý text');
  });

  it('odstraní více mention tagů', () => {
    const result = extractReplyText('<at>Bot</at> <at>Someone</at> Zpráva');
    expect(result).toBe('Zpráva');
  });
});
