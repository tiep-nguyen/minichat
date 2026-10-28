-- Povolení pgcrypto pro gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enum typy
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_status    AS ENUM ('pending', 'sent', 'delivered', 'failed');

-- ─── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  api_key_hash          VARCHAR(255) NOT NULL,   -- bcrypt hash, nikdy plaintext
  teams_webhook_url_enc BYTEA        NOT NULL,   -- AES-256-GCM šifrované
  teams_hmac_secret_enc BYTEA        NOT NULL,   -- AES-256-GCM šifrované
  require_auth          BOOLEAN      NOT NULL DEFAULT FALSE,
  rate_limit_per_minute INTEGER      NOT NULL DEFAULT 60,
  allowed_origins       TEXT[]       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_name ON tenants(name);

-- ─── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_user_id VARCHAR(128) NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_tenant_user ON conversations(tenant_id, external_user_id);

-- ─── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID              NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction        message_direction NOT NULL,
  content          TEXT              NOT NULL,
  status           message_status    NOT NULL DEFAULT 'pending',
  teams_message_id VARCHAR(255),
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- ─── Teams Correlations ───────────────────────────────────────────────────────
-- Propojení Teams message ID s naší conversation_id pro routing Outgoing Webhook odpovědí
CREATE TABLE teams_correlations (
  teams_message_id VARCHAR(255) PRIMARY KEY,
  conversation_id  UUID         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       UUID         NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_correlations_created ON teams_correlations(created_at);

-- ─── Auto-update updated_at trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
