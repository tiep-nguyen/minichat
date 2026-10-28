import { Router } from 'express';
import chatRoutes from './chat';
import webhookRoutes from './webhook';

const router = Router();

router.use('/chat', chatRoutes);
router.use('/webhooks', webhookRoutes);

export default router;
