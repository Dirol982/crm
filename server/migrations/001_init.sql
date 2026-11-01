-- Базовая схема мультитенантной CRM.
-- Каждая бизнес-сущность принадлежит tenant (компании-клиенту SaaS).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'trial',
  currency    text NOT NULL DEFAULT 'RUB',
  timezone    text NOT NULL DEFAULT 'Europe/Moscow',
  deal_stages jsonb NOT NULL DEFAULT '["new","contacted","proposal","negotiation","won","lost"]',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','manager','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Сайт/приложение клиента, откуда собирается статистика
CREATE TABLE sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  domain      text,
  public_key  text NOT NULL UNIQUE,  -- в JS-трекере, не секрет
  secret_key  text NOT NULL UNIQUE,  -- для серверного API заказов
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sites (tenant_id);

CREATE TABLE contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text,
  email      text,
  phone      text,
  company    text,
  source     text,
  notes      text,
  tags       text[] NOT NULL DEFAULT '{}',
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON contacts (tenant_id, created_at DESC);
CREATE UNIQUE INDEX contacts_email_uq ON contacts (tenant_id, lower(email)) WHERE email IS NOT NULL;

-- Анонимные посетители сайта (id генерирует трекер)
CREATE TABLE visitors (
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  id         text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, id)
);

CREATE TABLE sessions (
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  id               text NOT NULL,
  visitor_id       text NOT NULL,
  started_at       timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  landing_page     text,
  exit_page        text,
  referrer         text,
  source           text NOT NULL DEFAULT '(direct)',
  medium           text NOT NULL DEFAULT '(none)',
  campaign         text,
  device           text,
  browser          text,
  os               text,
  pageviews        int NOT NULL DEFAULT 0,
  events           int NOT NULL DEFAULT 0,
  duration_sec     int NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, id)
);
CREATE INDEX ON sessions (site_id, started_at);
CREATE INDEX ON sessions (site_id, visitor_id, started_at DESC);

CREATE TABLE pageviews (
  id           bigserial PRIMARY KEY,
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id   text NOT NULL,
  visitor_id   text NOT NULL,
  pv_id        text NOT NULL,
  path         text NOT NULL,
  title        text,
  ts           timestamptz NOT NULL,
  duration_sec int NOT NULL DEFAULT 0,
  UNIQUE (site_id, pv_id)
);
CREATE INDEX ON pageviews (site_id, ts);
CREATE INDEX ON pageviews (site_id, session_id);

CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id text,
  visitor_id text,
  name       text NOT NULL,
  path       text,
  value      numeric(14,2),
  props      jsonb NOT NULL DEFAULT '{}',
  ts         timestamptz NOT NULL
);
CREATE INDEX ON events (site_id, ts);
CREATE INDEX ON events (site_id, name, ts);

CREATE TABLE orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     uuid REFERENCES sites(id) ON DELETE SET NULL,
  external_id text,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  visitor_id  text,
  session_id  text,
  amount      numeric(14,2) NOT NULL,
  currency    text NOT NULL DEFAULT 'RUB',
  status      text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','cancelled','refunded')),
  items       jsonb NOT NULL DEFAULT '[]',
  -- атрибуция: источник визита, который привёл к заказу
  source      text,
  medium      text,
  campaign    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON orders (tenant_id, created_at);
CREATE UNIQUE INDEX orders_external_uq ON orders (tenant_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE deals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  title      text NOT NULL,
  amount     numeric(14,2) NOT NULL DEFAULT 0,
  stage      text NOT NULL DEFAULT 'new',
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz
);
CREATE INDEX ON deals (tenant_id, stage);

CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  due_at      timestamptz,
  done        boolean NOT NULL DEFAULT false,
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  contact_id  uuid REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id     uuid REFERENCES deals(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tasks (tenant_id, done, due_at);
