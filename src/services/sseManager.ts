import type { Response } from 'express';
import { SseEvent } from '../types';

// Analogie Vue eventBus / Pinia store subscriptions — bez reaktivity, čistý Node.js
// Key = conversationId, Value = Set aktivních SSE response objektů

const listeners = new Map<string, Set<Response>>();

/**
 * Zaregistruje SSE response objekt pro danou konverzaci.
 * Volat hned po nastavení SSE hlaviček.
 *
 * @param conversationId - UUID konverzace
 * @param res - Express Response objekt se SSE hlavičkami
 */
export function registerListener(conversationId: string, res: Response): void {
  if (!listeners.has(conversationId)) {
    listeners.set(conversationId, new Set());
  }
  listeners.get(conversationId)!.add(res);
}

/**
 * Odregistruje SSE response objekt (volat při odpojení klienta).
 *
 * @param conversationId - UUID konverzace
 * @param res - Express Response objekt k odebrání
 */
export function removeListener(conversationId: string, res: Response): void {
  const set = listeners.get(conversationId);
  if (!set) return;

  set.delete(res);

  if (set.size === 0) {
    listeners.delete(conversationId);
  }
}

/**
 * Odešle SSE event všem aktivním listenerům pro konverzaci.
 * Automaticky čistí uzavřená spojení.
 *
 * @param conversationId - UUID cílové konverzace
 * @param event - Event objekt s typem a daty
 */
export function emit(conversationId: string, event: SseEvent): void {
  const set = listeners.get(conversationId);
  if (!set || set.size === 0) return;

  const payload = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

  for (const res of set) {
    if (res.writableEnded) {
      set.delete(res);
      continue;
    }

    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }

  if (set.size === 0) {
    listeners.delete(conversationId);
  }
}

/**
 * Vrátí počet aktivních SSE spojení pro konverzaci.
 * Užitečné pro debugging nebo rozhodnutí o long-poll vs SSE.
 *
 * @param conversationId - UUID konverzace
 */
export function getListenerCount(conversationId: string): number {
  return listeners.get(conversationId)?.size ?? 0;
}
