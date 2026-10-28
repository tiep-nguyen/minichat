import { pool } from '../db/pool';
import { Result, ErrorCode, Conversation, Message, MessageStatus } from '../types';

/**
 * Najde existující konverzaci nebo vytvoří novou pro daný tenant + uživatel pár.
 * Pokud je předáno conversationId, ověří jeho existenci a ownership.
 *
 * @param tenantId - UUID tenanta
 * @param externalUserId - ID uživatele z klientské aplikace
 * @param conversationId - Volitelné existující conversation UUID
 * @returns Result<Conversation>
 */
export async function getOrCreateConversation(
  tenantId: string,
  externalUserId: string,
  conversationId?: string,
): Promise<Result<Conversation>> {
  try {
    // Pokud klient předal conversation ID, ověřit že patří tomuto tenantovi
    if (conversationId) {
      const { rows } = await pool.query<Conversation>(
        'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2',
        [conversationId, tenantId],
      );

      if (rows[0]) return { success: true, data: rows[0] };

      return {
        success: false,
        error: {
          code: ErrorCode.CONVERSATION_NOT_FOUND,
          message: 'Konverzace nenalezena nebo nepatří tomuto tenantovi',
          statusCode: 404,
        },
      };
    }

    // Pokud konverzace pro tento tenant+user existuje, vrátit ji
    const existing = await pool.query<Conversation>(
      'SELECT * FROM conversations WHERE tenant_id = $1 AND external_user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [tenantId, externalUserId],
    );

    if (existing.rows[0]) return { success: true, data: existing.rows[0] };

    // Jinak vytvořit novou
    const { rows } = await pool.query<Conversation>(
      'INSERT INTO conversations (tenant_id, external_user_id) VALUES ($1, $2) RETURNING *',
      [tenantId, externalUserId],
    );

    return { success: true, data: rows[0] };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při správě konverzace', statusCode: 500 },
    };
  }
}

/**
 * Uloží příchozí zprávu od klienta se statusem 'pending'.
 *
 * @param conversationId - UUID konverzace
 * @param content - Text zprávy
 * @returns Result<Message>
 */
export async function saveInboundMessage(
  conversationId: string,
  content: string,
): Promise<Result<Message>> {
  try {
    const { rows } = await pool.query<Message>(
      `INSERT INTO messages (conversation_id, direction, content, status)
       VALUES ($1, 'inbound', $2, 'pending')
       RETURNING *`,
      [conversationId, content],
    );

    return { success: true, data: rows[0] };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při ukládání zprávy', statusCode: 500 },
    };
  }
}

/**
 * Uloží odchozí zprávu (odpověď z MS Teams) se statusem 'delivered'.
 *
 * @param conversationId - UUID konverzace
 * @param content - Text odpovědi z Teams
 * @param teamsMessageId - Volitelné Teams message ID pro korelaci
 * @returns Result<Message>
 */
export async function saveOutboundMessage(
  conversationId: string,
  content: string,
  teamsMessageId?: string,
): Promise<Result<Message>> {
  try {
    const { rows } = await pool.query<Message>(
      `INSERT INTO messages (conversation_id, direction, content, status, teams_message_id)
       VALUES ($1, 'outbound', $2, 'delivered', $3)
       RETURNING *`,
      [conversationId, content, teamsMessageId ?? null],
    );

    return { success: true, data: rows[0] };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při ukládání odpovědi', statusCode: 500 },
    };
  }
}

/**
 * Aktualizuje status existující zprávy.
 *
 * @param messageId - UUID zprávy
 * @param status - Nový status
 * @returns Result<void>
 */
export async function updateMessageStatus(
  messageId: string,
  status: MessageStatus,
): Promise<Result<void>> {
  try {
    await pool.query(
      'UPDATE messages SET status = $1 WHERE id = $2',
      [status, messageId],
    );

    return { success: true, data: undefined };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při aktualizaci statusu', statusCode: 500 },
    };
  }
}

/**
 * Vrátí historii zpráv pro konverzaci.
 * Ověřuje vlastnictví konverzace přes JOIN s tenants.
 *
 * @param conversationId - UUID konverzace
 * @param tenantId - UUID tenanta pro ověření vlastnictví
 * @param limit - Maximum zpráv (výchozí 50)
 * @param before - Cursor: zprávy starší než toto datum
 * @returns Result<Message[]>
 */
export async function getMessageHistory(
  conversationId: string,
  tenantId: string,
  limit = 50,
  before?: Date,
): Promise<Result<Message[]>> {
  try {
    // Ověříme vlastnictví konverzace přes JOIN
    const ownerCheck = await pool.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId],
    );

    if (ownerCheck.rows.length === 0) {
      return {
        success: false,
        error: {
          code: ErrorCode.CONVERSATION_NOT_FOUND,
          message: 'Konverzace nenalezena',
          statusCode: 404,
        },
      };
    }

    const params: unknown[] = [conversationId, Math.min(limit, 100)];
    let cursor = '';

    if (before) {
      params.push(before);
      cursor = `AND created_at < $${params.length}`;
    }

    const { rows } = await pool.query<Message>(
      `SELECT * FROM messages
       WHERE conversation_id = $1 ${cursor}
       ORDER BY created_at ASC
       LIMIT $2`,
      params,
    );

    return { success: true, data: rows };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při načítání zpráv', statusCode: 500 },
    };
  }
}

/**
 * Vrátí nejnovější konverzaci pro daného tenanta.
 * Fallback když Power Automate nevrátí Teams message ID pro korelaci.
 */
export async function findLatestConversationByTenantId(
  tenantId: string,
): Promise<Result<{ conversationId: string }>> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM conversations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1',
      [tenantId],
    );

    if (!rows[0]) {
      return {
        success: false,
        error: { code: ErrorCode.CONVERSATION_NOT_FOUND, message: 'Žádná konverzace pro tenanta', statusCode: 404 },
      };
    }

    return { success: true, data: { conversationId: rows[0].id } };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při hledání konverzace', statusCode: 500 },
    };
  }
}

/**
 * Uloží korelaci Teams message ID ↔ conversation ID.
 * Používá se pro routing Outgoing Webhook odpovědí zpět na správnou konverzaci.
 *
 * @param teamsMessageId - ID zprávy z Teams API response
 * @param conversationId - UUID naší konverzace
 * @param messageId - UUID naší inbound zprávy
 */
export async function saveTeamsCorrelation(
  teamsMessageId: string,
  conversationId: string,
  messageId: string,
): Promise<Result<void>> {
  try {
    await pool.query(
      `INSERT INTO teams_correlations (teams_message_id, conversation_id, message_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (teams_message_id) DO NOTHING`,
      [teamsMessageId, conversationId, messageId],
    );

    return { success: true, data: undefined };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při ukládání Teams korelace', statusCode: 500 },
    };
  }
}

/**
 * Najde conversation ID na základě Teams message ID.
 *
 * @param teamsMessageId - ID z Teams Outgoing Webhook payloadu
 * @returns Result<{ conversationId: string; messageId: string }>
 */
export async function findConversationByTeamsMessageId(
  teamsMessageId: string,
): Promise<Result<{ conversationId: string; messageId: string }>> {
  try {
    const { rows } = await pool.query<{ conversation_id: string; message_id: string }>(
      'SELECT conversation_id, message_id FROM teams_correlations WHERE teams_message_id = $1',
      [teamsMessageId],
    );

    if (!rows[0]) {
      return {
        success: false,
        error: {
          code: ErrorCode.CONVERSATION_NOT_FOUND,
          message: 'Nenalezena korelace pro Teams message ID',
          statusCode: 404,
        },
      };
    }

    return {
      success: true,
      data: { conversationId: rows[0].conversation_id, messageId: rows[0].message_id },
    };
  } catch {
    return {
      success: false,
      error: { code: ErrorCode.DATABASE_ERROR, message: 'Chyba DB při hledání korelace', statusCode: 500 },
    };
  }
}
