import crypto from 'crypto';
import { env } from '../config/env';
import { HMAC_TIMESTAMP_TOLERANCE_MS } from '../config/constants';
import { Result, ErrorCode } from '../types';

/**
 * Sestaví Adaptive Card payload pro Teams Workflows webhook (Power Automate).
 * Workflows trigger s "Adaptive Card" dynamic content očekává přímo objekt karty
 * bez outer attachments wrapperu (který používal starý Incoming Webhook Connector).
 */
export function buildWorkflowPayload(text: string): object {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body: [{ type: 'TextBlock', text, wrap: true }],
        },
      },
    ],
  };
}

/**
 * Odešle zprávu do MS Teams přes Incoming Webhook URL.
 * Retry s exponential backoff: pokus 0 = ihned, 1 = 1s, 2 = 2s.
 * Timeout 8s per pokus pomocí AbortController.
 * Webhook URL se nikdy neloguje.
 *
 * @param webhookUrl - Decrypted Teams Incoming Webhook URL (z TenantRuntime)
 * @param content - Text zprávy
 * @returns Result s volitelným teamsMessageId nebo chybou
 */
export async function sendToTeams(
  webhookUrl: string,
  content: string,
): Promise<Result<{ teamsMessageId?: string }>> {
  const body = JSON.stringify(buildWorkflowPayload(content));

  const maxAttempts = env.TEAMS_MAX_RETRY + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(attempt * 1000);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.TEAMS_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // Teams Incoming Webhooks nevrací ID — okayové jsou 200/204
        return { success: true, data: {} };
      }

      const status = response.status;
      console.warn(`[teams] Webhook selhal (pokus ${attempt + 1}/${maxAttempts}) — HTTP ${status}`);

      // 4xx chyby nemá smysl retryovat
      if (status >= 400 && status < 500) {
        return {
          success: false,
          error: { code: ErrorCode.TEAMS_DELIVERY_FAILED, message: `Teams odmítl zprávu (HTTP ${status})`, statusCode: 502 },
        };
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = (err as Error).name === 'AbortError';
      console.warn(`[teams] Chyba odeslání (pokus ${attempt + 1}/${maxAttempts}) — ${isAbort ? 'timeout' : 'síťová chyba'}`);
    }
  }

  return {
    success: false,
    error: { code: ErrorCode.TEAMS_DELIVERY_FAILED, message: 'Doručení do Teams selhalo po všech pokusech', statusCode: 502 },
  };
}

export function verifyTeamsHmac(
  hmacSecret: string,
  authorizationHeader: string,
  rawBody: Buffer,
  timestamp: string,
): Result<void> {
  const messageTime = new Date(timestamp).getTime();
  if (isNaN(messageTime)) {
    return {
      success: false,
      error: { code: ErrorCode.INVALID_HMAC, message: 'Neplatný timestamp v payloadu', statusCode: 401 },
    };
  }

  if (Math.abs(Date.now() - messageTime) > HMAC_TIMESTAMP_TOLERANCE_MS) {
    return {
      success: false,
      error: { code: ErrorCode.REPLAY_ATTACK, message: 'Zpráva je příliš stará (replay protection)', statusCode: 401 },
    };
  }

  const parts = authorizationHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'HMAC') {
    return {
      success: false,
      error: { code: ErrorCode.INVALID_HMAC, message: 'Chybějící nebo neplatný HMAC Authorization header', statusCode: 401 },
    };
  }

  let receivedHmac: Buffer;
  try {
    receivedHmac = Buffer.from(parts[1], 'base64');
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.INVALID_HMAC, message: 'Neplatný base64 v HMAC tokenu', statusCode: 401 },
    };
  }

  const secretBytes  = Buffer.from(hmacSecret, 'base64');
  const computedHmac = crypto.createHmac('sha256', secretBytes).update(rawBody).digest();

  if (
    computedHmac.length !== receivedHmac.length ||
    !crypto.timingSafeEqual(computedHmac, receivedHmac)
  ) {
    return {
      success: false,
      error: { code: ErrorCode.INVALID_HMAC, message: 'Neplatný HMAC podpis', statusCode: 401 },
    };
  }

  return { success: true, data: undefined };
}

/**
 * Extrahuje text odpovědi z Teams Outgoing Webhook payloadu.
 * Teams obaluje text mention tagem: "<at>BotName</at> skutečný text"
 *
 * @param rawText - Surový text z payload.text
 * @returns Vyčištěný text bez mention tagů
 */
export function extractReplyText(rawText: string): string {
  // Odstranit <at>...</at> tagy a okolní mezery
  return rawText.replace(/<at>[^<]*<\/at>/g, '').trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
