import type { RequestHandler } from 'express';

/**
 * Loguje HTTP requesty — POUZE metadata, nikdy obsah zpráv.
 * Logovaná pole: method, path, status, responseTime, tenantId.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;

    // tenant je připojen auth middlewarem — může být undefined pro /health endpoint
    const tenantId = req.tenant?.id ?? 'anonymous';

    console.log(JSON.stringify({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      tenantId,
    }));
  });

  next();
};
