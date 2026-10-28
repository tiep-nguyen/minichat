import type { RequestHandler } from 'express';
import {
  getOrCreateConversation,
  saveInboundMessage,
  updateMessageStatus,
  getMessageHistory,
  saveTeamsCorrelation,
} from '../services/chatService';
import { sendToTeams } from '../services/teamsService';
import { registerListener, removeListener, emit } from '../services/sseManager';
import { SendMessageSchema, ErrorCode } from '../types';
import { SSE_PING_INTERVAL_MS, SSE_MAX_DURATION_MS } from '../config/constants';

/**
 * POST /api/v1/chat/message
 * Přijme zprávu od klientské aplikace, uloží ji a přepošle do MS Teams.
 */
export const sendMessage: RequestHandler = async (req, res) => {
  const tenant = req.tenant!;

  // ── Validace vstupu ────────────────────────────────────────────────────────
  const parsed = SendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Neplatná data',
        details: parsed.error.flatten().fieldErrors,
        statusCode: 400,
      },
    });
    return;
  }

  const { external_user_id, conversation_id, content } = parsed.data;

  // ── Konverzace ─────────────────────────────────────────────────────────────
  const convResult = await getOrCreateConversation(tenant.id, external_user_id, conversation_id);
  if (!convResult.success) {
    res.status(convResult.error.statusCode).json({ error: convResult.error });
    return;
  }

  const conversation = convResult.data;

  // ── Uložení zprávy ─────────────────────────────────────────────────────────
  const msgResult = await saveInboundMessage(conversation.id, content);
  if (!msgResult.success) {
    res.status(msgResult.error.statusCode).json({ error: msgResult.error });
    return;
  }

  const message = msgResult.data;
  console.log(`[chat] Zpráva uložena — messageId=${message.id} conversationId=${conversation.id} tenantId=${tenant.id}`);

  // ── Odeslání do Teams ──────────────────────────────────────────────────────
  const teamsResult = await sendToTeams(tenant.teams_webhook_url, content);

  if (!teamsResult.success) {
    // Teams selhalo — označit zprávu jako failed, ale klientovi vrátit 202 s info
    await updateMessageStatus(message.id, 'failed');
    console.warn(`[chat] Teams doručení selhalo — messageId=${message.id}`);

    res.status(202).json({
      messageId: message.id,
      conversationId: conversation.id,
      status: 'failed',
    });
    return;
  }

  // ── Úspěšné odeslání ───────────────────────────────────────────────────────
  await updateMessageStatus(message.id, 'sent');

  // Uložit korelaci Teams message ID ↔ naše conversation (pro routing odpovědi)
  if (teamsResult.data.teamsMessageId) {
    await saveTeamsCorrelation(teamsResult.data.teamsMessageId, conversation.id, message.id);
  }

  console.log(`[chat] Odesláno do Teams — messageId=${message.id} status=sent`);

  res.status(202).json({
    messageId: message.id,
    conversationId: conversation.id,
    status: 'sent',
  });
};

/**
 * GET /api/v1/chat/conversation/:id/messages
 * Vrátí historii zpráv pro konverzaci.
 */
export const getMessages: RequestHandler = async (req, res) => {
  const tenant = req.tenant!;
  const conversationId = req.params.id;

  const before = req.query.before ? new Date(req.query.before as string) : undefined;
  const limit  = req.query.limit  ? parseInt(req.query.limit as string, 10) : 50;

  const result = await getMessageHistory(conversationId, tenant.id, limit, before);

  if (!result.success) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.json({ messages: result.data });
};

/**
 * GET /api/v1/chat/conversation/:id/stream
 * Server-Sent Events — real-time odpovědi z Teams.
 * Klient se připojí po odeslání zprávy a čeká na odpověď.
 */
export const streamConversation: RequestHandler = (req, res) => {
  const conversationId = req.params.id;

  // ── SSE hlavičky ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Vypnutí Nginx bufferingu
  res.flushHeaders();

  registerListener(conversationId, res);

  // ── Ping každých 30s (keep-alive) ─────────────────────────────────────────
  const pingInterval = setInterval(() => {
    emit(conversationId, { event: 'ping', data: { ts: Date.now() } });
  }, SSE_PING_INTERVAL_MS);

  // ── Automatické ukončení po max době ──────────────────────────────────────
  const maxTimeout = setTimeout(() => {
    cleanup();
    res.end();
  }, SSE_MAX_DURATION_MS);

  function cleanup() {
    clearInterval(pingInterval);
    clearTimeout(maxTimeout);
    removeListener(conversationId, res);
  }

  req.on('close', cleanup);
};
