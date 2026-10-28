import type { RequestHandler } from 'express';

/**
 * Zachytí raw body request jako Buffer PŘED jakýmkoliv JSON parsováním.
 * Nutné pro HMAC verifikaci Teams Outgoing Webhook — HMAC se počítá nad raw bytes.
 *
 * DŮLEŽITÉ: Tento middleware musí být aplikován na webhook route PŘED express.json().
 */
export const captureRawBody: RequestHandler = (req, _res, next) => {
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
};
