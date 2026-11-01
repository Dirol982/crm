-- Письма: очередь отправки, сброс пароля, приглашения, напоминания

ALTER TABLE users
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN email_digest boolean NOT NULL DEFAULT true;   -- еженедельный отчёт

-- Одноразовые токены (сброс пароля). Храним только хеш.
CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_tokens (user_id, kind);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text,
  role        text NOT NULL CHECK (role IN ('admin','manager','viewer')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE UNIQUE INDEX invitations_open_uq ON invitations (tenant_id, lower(email)) WHERE accepted_at IS NULL;

-- Очередь писем
CREATE TABLE emails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  html            text NOT NULL,
  text            text NOT NULL,
  headers         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX ON emails (status, next_attempt_at) WHERE status IN ('pending','sending');
CREATE INDEX ON emails (tenant_id, created_at DESC);

-- Какие напоминания уже отправлены (чтобы не слать дважды)
CREATE TABLE notifications_sent (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  ref        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, ref)
);
