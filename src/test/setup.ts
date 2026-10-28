// Načtení testovacích env proměnných před každým testem
process.env.NODE_ENV        = 'test';
process.env.PORT            = '3001';
process.env.DATABASE_URL    = 'postgresql://postgres:password@localhost:5432/tmechat_test';
process.env.ENCRYPTION_KEY  = 'a'.repeat(64); // 64 hex znaků pro testy
process.env.JWT_SECRET      = 'test-jwt-secret-minimum-32-characters-long';
process.env.JWT_EXPIRES_IN  = '1h';
process.env.TENANT_CACHE_TTL = '60';
process.env.TEAMS_TIMEOUT_MS = '8000';
process.env.TEAMS_MAX_RETRY  = '2';
