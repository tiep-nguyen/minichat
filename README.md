# MiniChat

Security bridge a multi-tenant chat storage pro TME ekosystém.
Klientské aplikace posílají zprávy přes REST API, MiniChat je přeposílá do MS Teams a vrací odpovědi zpět v reálném čase přes SSE.

---

## Architektura

```
Klientská App
    │
    │  POST /api/v1/chat/message
    │  Header: X-Api-Key
    ▼
┌─────────────┐
│  MiniChat   │  ──→  MS Teams Incoming Webhook
│   Backend   │  ←──  MS Teams Outgoing Webhook
└─────────────┘
    │
    ▼
PostgreSQL
```

### Tok dat

1. Klient pošle zprávu s API klíčem
2. MiniChat ověří klíč → identifikuje tenanta → uloží zprávu
3. MiniChat přepošle zprávu do MS Teams (Adaptive Card)
4. Teams agent odpoví přes Outgoing Webhook
5. MiniChat ověří HMAC podpis → uloží odpověď
6. Odpověď se doručí klientovi přes SSE stream

---

## Stack

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **Databáze**: PostgreSQL 15+ s pgcrypto
- **Jazyk**: TypeScript (strict mode)
- **Autentizace**: API klíče (bcrypt) + volitelný JWT
- **Šifrování**: AES-256-GCM pro Teams secrets

---

## Rychlý start

### 1. Požadavky

- Node.js 20+
- Docker (pro PostgreSQL)
- ngrok (pro testování Teams Outgoing Webhook lokálně)

### 2. Klonování a instalace

```bash
git clone <repo>
cd TMEchat
npm install
```

### 3. Spuštění PostgreSQL přes Docker

```bash
docker run -d \
  --name tmechat-db \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=tmechat \
  -p 5432:5432 \
  postgres:16
```

### 4. Konfigurace prostředí

```bash
cp .env.example .env
```

Otevřete `.env` a vyplňte:

```bash
# Vygenerujte ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Vygenerujte JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Spuštění migrací

```bash
npm run migrate
```

### 6. Vytvoření prvního tenanta

```bash
npm run seed
```

Interaktivní průvodce se zeptá na:
- Název tenanta
- MS Teams Incoming Webhook URL
- MS Teams HMAC Secret
- Rate limit, CORS origins

**API klíč se zobrazí pouze jednou — uložte si ho.**

### 7. Spuštění dev serveru

```bash
npm run dev
```

Server naslouchá na `http://localhost:3000`.

---

## API Reference

Všechny endpointy vyžadují hlavičku `X-Api-Key`.

### POST `/api/v1/chat/message`

Odešle zprávu do MS Teams.

**Headers:**
```
X-Api-Key: <váš_api_klíč>
Content-Type: application/json
Authorization: Bearer <jwt>   # pouze pokud tenant.require_auth = true
```

**Body:**
```json
{
  "external_user_id": "user-123",
  "content": "Ahoj, potřebuji pomoc s objednávkou #456",
  "conversation_id": "uuid"   // volitelné — pokračování existující konverzace
}
```

**Odpověď `202`:**
```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "status": "sent"
}
```

`status` může být `sent` (doručeno do Teams) nebo `failed` (Teams nedostupné).

---

### GET `/api/v1/chat/conversation/:id/messages`

Vrátí historii zpráv konverzace.

**Query parametry:**
| Parametr | Typ | Popis |
|----------|-----|-------|
| `limit` | number | Max počet zpráv (výchozí 50, max 100) |
| `before` | ISO datum | Cursor pro stránkování |

**Odpověď `200`:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "direction": "inbound",
      "content": "Ahoj, potřebuji pomoc",
      "status": "sent",
      "created_at": "2024-01-01T10:00:00Z"
    },
    {
      "id": "uuid",
      "direction": "outbound",
      "content": "Dobrý den, s čím mohu pomoci?",
      "status": "delivered",
      "created_at": "2024-01-01T10:00:30Z"
    }
  ]
}
```

---

### GET `/api/v1/chat/conversation/:id/stream`

Server-Sent Events — real-time odpovědi z Teams.

```javascript
// Příklad použití v klientské aplikaci
const source = new EventSource(
  `http://localhost:3000/api/v1/chat/conversation/${conversationId}/stream`,
  { headers: { 'X-Api-Key': apiKey } }
);

source.addEventListener('message', (e) => {
  const reply = JSON.parse(e.data);
  console.log('Odpověď z Teams:', reply);
});

source.addEventListener('ping', () => {
  // keep-alive, každých 30s
});
```

SSE spojení se automaticky ukončí po 5 minutách.

---

### POST `/api/v1/webhooks/teams/:tenantId`

Příjem odpovědí z MS Teams Outgoing Webhook.
Tento endpoint je určen pro Teams — nevolat přímo.

**Ověření:** HMAC-SHA256 podpis v `Authorization: HMAC <base64>` hlavičce.
**Replay protection:** Zprávy starší než 5 minut jsou odmítnuty.

---

### GET `/health`

Health check bez autentizace.

```json
{ "status": "ok" }
```

---

## Multitenancy

Každý tenant je izolovaná instance s vlastní konfigurací:

| Vlastnost | Popis |
|-----------|-------|
| `api_key_hash` | bcrypt hash API klíče |
| `teams_webhook_url_enc` | AES-256-GCM šifrovaná Teams URL |
| `teams_hmac_secret_enc` | AES-256-GCM šifrovaný HMAC secret |
| `require_auth` | Vyžadovat JWT nad rámec API klíče |
| `rate_limit_per_minute` | Max zpráv za minutu |
| `allowed_origins` | Whitelist CORS origins |

Tenant konfigurace se cachuje v paměti s TTL 60s.

---

## Bezpečnost

### Co je chráněno

| Hrozba | Ochrana |
|--------|---------|
| Timing útok na API klíč | `crypto.timingSafeEqual` + bcrypt |
| Replay útok na Teams webhook | Timestamp tolerance 5 minut |
| Podvržení Teams odpovědi | HMAC-SHA256 verifikace nad raw body |
| Únik Teams URL | AES-256-GCM šifrování v DB, nikdy v logu |
| Brute force | Rate limiting per tenant |
| XSS/clickjacking hlavičky | Helmet.js |
| SQL injection | Výhradně parametrizované dotazy |

### Co se nikdy neloguje

- Obsah zpráv
- API klíče
- Teams Webhook URL
- JWT tokeny
- Šifrovací klíče

Logy obsahují pouze: `method`, `path`, `status`, `ms`, `tenantId`, `messageId`.

---

## Databázové schéma

```
tenants
  ├── id (UUID PK)
  ├── name
  ├── api_key_hash          ← bcrypt
  ├── teams_webhook_url_enc ← AES-256-GCM bytea
  ├── teams_hmac_secret_enc ← AES-256-GCM bytea
  ├── require_auth
  ├── rate_limit_per_minute
  └── allowed_origins[]

conversations
  ├── id (UUID PK)
  ├── tenant_id → tenants
  └── external_user_id

messages
  ├── id (UUID PK)
  ├── conversation_id → conversations
  ├── direction: inbound | outbound
  ├── content
  ├── status: pending | sent | delivered | failed
  └── teams_message_id

teams_correlations
  ├── teams_message_id (PK)
  ├── conversation_id → conversations
  └── message_id → messages
```

---

## Konfigurace MS Teams

### Incoming Webhook (pro odesílání do Teams)

1. V Teams kanálu → **Connectors** → **Incoming Webhook**
2. Pojmenujte webhook (např. "MiniChat")
3. Zkopírujte URL — zadáte ji při `npm run seed`

### Outgoing Webhook (pro příjem odpovědí)

1. V Teams kanálu → **Apps** → **Outgoing Webhook**
2. Nastavte **Callback URL** na:
   ```
   https://<váš-ngrok-tunel>/api/v1/webhooks/teams/<tenantId>
   ```
3. Zkopírujte **Security token** (HMAC secret) — zadáte při `npm run seed`

### Lokální vývoj s ngrok

```bash
# Instalace
brew install ngrok

# Spuštění tunelu
ngrok http 3000
```

Ngrok vám dá veřejnou URL (např. `https://abc123.ngrok.io`).
Nastavte ji jako Callback URL v Teams Outgoing Webhook konfiguraci.

---

## Vývoj

```bash
# Dev server s hot reload
npm run dev

# Testy
npm test
npm run test:watch
npm run test:coverage

# TypeScript check
npm run typecheck

# Build pro produkci
npm run build
npm start
```

### Struktura projektu

```
src/
├── config/
│   ├── env.ts          # Validace env proměnných při startu
│   └── constants.ts    # Aplikační konstanty
├── db/
│   ├── pool.ts         # PostgreSQL connection pool
│   ├── migrate.ts      # Migrace runner
│   ├── seed.ts         # Vytvoření prvního tenanta
│   └── migrations/
│       └── 001_initial_schema.sql
├── services/
│   ├── cryptoService.ts   # AES-256-GCM encrypt/decrypt
│   ├── tenantService.ts   # Cache + DB lookup tenantů
│   ├── authService.ts     # API key + JWT verifikace
│   ├── chatService.ts     # CRUD zpráv a konverzací
│   ├── teamsService.ts    # Teams HTTP + HMAC verifikace
│   └── sseManager.ts      # SSE pub-sub manager
├── middleware/
│   ├── auth.ts            # authenticateTenant + CORS
│   ├── rateLimiter.ts     # Sliding window per tenant
│   ├── rawBody.ts         # Zachytí raw bytes pro HMAC
│   ├── errorHandler.ts    # Globální error handler
│   └── requestLogger.ts   # Bezpečné logování
├── controllers/
│   ├── chatController.ts     # sendMessage, getMessages, SSE
│   └── webhookController.ts  # Teams Outgoing Webhook
├── routes/
│   ├── chat.ts, webhook.ts, index.ts
├── types/
│   └── index.ts   # Všechny TypeScript typy, Result<T>, Zod schemas
├── test/
│   ├── setup.ts, fixtures.ts
├── app.ts     # Express aplikace factory
└── server.ts  # Entry point
```

---

## Environment proměnné

| Proměnná | Popis | Výchozí |
|----------|-------|---------|
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `PORT` | Port serveru | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `ENCRYPTION_KEY` | 64 hex znaků (32 bytes) pro AES-256-GCM | — |
| `JWT_SECRET` | Min. 32 znaků | — |
| `JWT_EXPIRES_IN` | Platnost JWT tokenu | `1h` |
| `TENANT_CACHE_TTL` | TTL cache tenantů v sekundách | `60` |
| `TEAMS_TIMEOUT_MS` | Timeout Teams HTTP requestu | `8000` |
| `TEAMS_MAX_RETRY` | Max počet retry pokusů | `2` |
