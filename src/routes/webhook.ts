import { Router } from 'express';
import { captureRawBody } from '../middleware/rawBody';
import { receiveTeamsWebhook } from '../controllers/webhookController';

const router = Router();

// captureRawBody MUSÍ být před express.json() — jinak se raw body ztratí
// Na tomto endpointu žádná JWT/API key autentizace — autentizace je přes HMAC
router.post('/teams/:tenantId', captureRawBody, receiveTeamsWebhook);

export default router;
