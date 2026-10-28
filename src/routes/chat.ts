import { Router } from 'express';
import { authenticateTenant } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/rateLimiter';
import { sendMessage, getMessages, streamConversation } from '../controllers/chatController';

const router = Router();

// Všechny chat endpointy vyžadují platný API klíč + respektují rate limit
router.use(authenticateTenant, tenantRateLimiter);

router.post('/message', sendMessage);
router.get('/conversation/:id/messages', getMessages);
router.get('/conversation/:id/stream', streamConversation);

export default router;
