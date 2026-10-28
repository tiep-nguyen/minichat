import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import apiRoutes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

export function createApp() {
  const app = express();

  // ── Bezpečnostní hlavičky ─────────────────────────────────────────────────
  app.use(helmet());

  // Global CORS je záměrně zakázán — per-tenant CORS nastavuje auth middleware
  // dle tenant.allowed_origins po ověření API klíče
  app.use(cors({ origin: false }));

  // ── Body parsing ──────────────────────────────────────────────────────────
  // Webhook route má vlastní captureRawBody — express.json() by zkonzumoval stream
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/webhooks')) return next();
    express.json({ limit: '64kb' })(req, res, next);
  });

  // ── Logging ───────────────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Health check (bez autentizace) ────────────────────────────────────────
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/api/v1', apiRoutes);

  // ── Error handler — musí být poslední ────────────────────────────────────
  app.use(errorHandler);

  return app;
}
