import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url('DATABASE_URL musí být platná URL'),

  // 32 bytes binárně = 64 hex znaků
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY musí mít přesně 64 hex znaků (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY musí být hex string'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET musí mít alespoň 32 znaků'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  TENANT_CACHE_TTL: z.coerce.number().default(60),

  TEAMS_TIMEOUT_MS: z.coerce.number().default(8000),
  TEAMS_MAX_RETRY: z.coerce.number().default(2),
});

// Při startu aplikace — pokud validace selže, proces okamžitě skončí s jasnou chybou
const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[config] Chybí nebo jsou neplatné env proměnné:');
  parsed.error.issues.forEach(issue => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
