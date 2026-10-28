import type { ErrorRequestHandler } from 'express';
import { env } from '../config/env';
import { AppError, ErrorCode } from '../types';

/**
 * Globální Express error handler — musí být registrován jako POSLEDNÍ middleware.
 * V produkci nevracíme stack trace. Nikdy nelogujeme obsah zpráv.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Pokud je to náš typovaný AppError
  if (isAppError(err)) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // Neočekávaná chyba — logujeme kód/typ, ne data
  console.error('[error] Neočekávaná chyba:', {
    name: (err as Error).name,
    message: (err as Error).message,
    ...(env.NODE_ENV !== 'production' && { stack: (err as Error).stack }),
  });

  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;

  res.status(statusCode).json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: env.NODE_ENV === 'production' ? 'Interní chyba serveru' : (err as Error).message,
    },
  });
};

function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'statusCode' in err &&
    'message' in err
  );
}
