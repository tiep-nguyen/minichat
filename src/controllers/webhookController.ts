import type { RequestHandler } from 'express';
import { getTenantById } from '../services/tenantService';
import { verifyTeamsHmac, extractReplyText } from '../services/teamsService';
import {
  findConversationByTeamsMessageId,
  findLatestConversationByTenantId,
  saveOutboundMessage,
} from '../services/chatService';
import { emit } from '../services/sseManager';
import { TeamsOutgoingWebhookSchema, ErrorCode } from '../types';

// Regex pro validaci UUID v URL parametru
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/webhooks/teams/:tenantId
 * Přijme odpověď z MS Teams Outgoing Webhook.
 * Musí odpovědět do 5s (Teams timeout) — vždy vrátí 200 okamžitě.
 */
export const receiveTeamsWebhook: RequestHandler = async (req, res) => {
  const { tenantId } = req.params;

  // ── Validace tenantId parametru ───────────────────────────────────────────
  if (!UUID_REGEX.test(tenantId)) {
    res.status(400).json({
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Neplatné tenantId', statusCode: 400 },
    });
    return;
  }

  // ── Načtení tenanta ───────────────────────────────────────────────────────
  const tenantResult = await getTenantById(tenantId);
  if (!tenantResult.success) {
    res.status(tenantResult.error.statusCode).json({ error: tenantResult.error });
    return;
  }

  const tenant = tenantResult.data;

  // ── Raw body ──────────────────────────────────────────────────────────────
  const rawBody = req.rawBody;
  if (!rawBody || rawBody.length === 0) {
    res.status(400).json({
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Prázdné tělo requestu', statusCode: 400 },
    });
    return;
  }

  // ── Parsování body ─────────────────────────────────────────────────────────
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Neplatný JSON', statusCode: 400 },
    });
    return;
  }

  const payloadResult = TeamsOutgoingWebhookSchema.safeParse(parsedBody);
  if (!payloadResult.success) {
    res.status(400).json({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Neplatná struktura Teams payloadu',
        statusCode: 400,
      },
    });
    return;
  }

  const payload = payloadResult.data;

  // ── HMAC verifikace ───────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? '';
  const hmacResult = verifyTeamsHmac(
    tenant.teams_hmac_secret,
    authHeader,
    rawBody,
    payload.timestamp ?? '',
  );

  if (!hmacResult.success) {
    console.warn(`[webhook] Neplatný HMAC — tenantId=${tenantId} code=${hmacResult.error.code}`);
    res.status(hmacResult.error.statusCode).json({ error: hmacResult.error });
    return;
  }

  // ── Odeslat 200 okamžitě — Teams má 5s timeout ───────────────────────────
  // Teams vyžaduje neprázdný text jinak zobrazí chybovou hlášku
  res.status(200).json({ type: 'message', text: 'Zpráva přijata ✓' });

  // ── Zpracování odpovědi ───────────────────────────────────────────────────
  void processTeamsReply(tenantId, payload.id, payload.text);
};

async function processTeamsReply(
  tenantId: string,
  teamsMessageId: string | undefined,
  rawText: string | undefined,
): Promise<void> {
  if (!rawText?.trim()) {
    console.log(`[webhook] Prázdná odpověď z Teams — tenantId=${tenantId}`);
    return;
  }

  // Vyčistit mention tagy (<at>BotName</at>)
  const replyText = extractReplyText(rawText);

  if (!replyText) {
    console.log(`[webhook] Text po vyčištění prázdný — tenantId=${tenantId}`);
    return;
  }

  // Najít konverzaci přes Teams message ID korelaci
  let conversationId: string | undefined;

  if (teamsMessageId) {
    const corrResult = await findConversationByTeamsMessageId(teamsMessageId);
    if (corrResult.success) {
      conversationId = corrResult.data.conversationId;
    }
  }

  if (!conversationId) {
    // Fallback — Power Automate nevrací Teams message ID, použij nejnovější konverzaci
    const fallback = await findLatestConversationByTenantId(tenantId);
    if (!fallback.success) {
      console.warn(`[webhook] Žádná konverzace pro tenanta — tenantId=${tenantId}`);
      return;
    }
    conversationId = fallback.data.conversationId;
    console.log(`[webhook] Fallback na nejnovější konverzaci — conversationId=${conversationId}`);
  }

  // Uložit odpověď
  const msgResult = await saveOutboundMessage(conversationId, replyText, teamsMessageId);
  if (!msgResult.success) {
    console.error(`[webhook] Chyba ukládání odpovědi — conversationId=${conversationId}`);
    return;
  }

  const message = msgResult.data;
  console.log(`[webhook] Odpověď uložena — messageId=${message.id} conversationId=${conversationId}`);

  // Notifikovat SSE listenery
  emit(conversationId, {
    event: 'message',
    data: {
      id: message.id,
      direction: message.direction,
      status: message.status,
      created_at: message.created_at,
    },
  });
}
