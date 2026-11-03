-- ИИ-агенты для рекламы: аккаунты площадок, кампании, статистика, правила, запуски, изменения

CREATE TABLE ad_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('yandex','vk','google','telegram','demo')),  -- demo — учебный кабинет без реальной рекламы
  name          text NOT NULL,
  login         text,                 -- Client-Login Директа / ID клиента Google / ID кабинета VK
  secret        text,                 -- токены, зашифрованы (AES-256-GCM); у Telegram — пусто
  active        boolean NOT NULL DEFAULT true,
  last_sync_at  timestamptz,
  sync_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ad_accounts (tenant_id);

CREATE TABLE ad_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')),
  daily_budget  numeric(14,2),        -- в валюте кабинета; NULL — без дневного ограничения
  currency      text NOT NULL DEFAULT 'RUB',
  utm_campaign  text,                 -- как кампания называется в UTM — по нему считаем выручку из CRM
  autopilot     boolean NOT NULL DEFAULT false,  -- разрешено ли агенту менять эту кампанию сам
  demo          jsonb,                -- параметры модели спроса учебной кампании; у настоящих — NULL
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX ON ad_campaigns (tenant_id);

CREATE TABLE ad_stats (
  campaign_id   uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  day           date NOT NULL,
  impressions   int NOT NULL DEFAULT 0,
  clicks        int NOT NULL DEFAULT 0,
  cost          numeric(14,2) NOT NULL DEFAULT 0,
  conversions   numeric(12,2) NOT NULL DEFAULT 0,   -- конверсии по данным площадки
  revenue       numeric(14,2) NOT NULL DEFAULT 0,   -- ТОЛЬКО учебный кабинет: его «выручка» не смешивается с заказами CRM
  PRIMARY KEY (campaign_id, day)
);

-- Правила, в рамках которых агент работает. Жёсткие лимиты проверяются кодом, а не моделью.
CREATE TABLE ad_policies (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  mode                   text NOT NULL DEFAULT 'suggest' CHECK (mode IN ('off','suggest','autopilot')),
  max_change_pct         int NOT NULL DEFAULT 20 CHECK (max_change_pct BETWEEN 1 AND 100),
  max_campaign_budget    numeric(14,2),     -- потолок дневного бюджета одной кампании
  max_total_budget       numeric(14,2),     -- потолок суммы дневных бюджетов всех кампаний
  min_clicks             int NOT NULL DEFAULT 100,  -- меньше кликов за 14 дней — данных мало, не трогаем
  allow_pause            boolean NOT NULL DEFAULT true,
  target_roas            numeric(8,2),      -- цель: выручка / расход
  max_cpa                numeric(14,2),     -- цель: стоимость заказа не выше
  cooldown_hours         int NOT NULL DEFAULT 48,   -- после изменения кампанию не трогаем N часов
  rollback_threshold_pct int NOT NULL DEFAULT 30,   -- откат, если после изменения стало хуже на N%
  controller_enabled     boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('optimize','monitor')),
  trigger       text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule','manual')),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  summary       text,
  model         text,
  input_tokens  int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX ON agent_runs (tenant_id, started_at DESC);

CREATE TABLE ad_actions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id             uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  campaign_id        uuid REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('budget','pause','resume','recommendation')),
  old_value          jsonb,
  new_value          jsonb,
  reason             text NOT NULL,
  expected           text,
  -- proposed → applied → (kept | rolled_back);  proposed → rejected;  applied/approve → failed
  status             text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','rejected','failed','rolled_back','done')),
  policy_ok          boolean NOT NULL DEFAULT true,
  policy_note        text,                -- почему правила не пропустили автоприменение
  controller_verdict text CHECK (controller_verdict IN ('approve','reject','uncertain')),
  controller_note    text,
  decided_by         text CHECK (decided_by IN ('autopilot','user','controller','monitor')),
  decided_user       uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_at         timestamptz,
  check_after        timestamptz,         -- когда контролёр проверит результат
  check_result       jsonb,
  rolled_back_at     timestamptz,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ad_actions (tenant_id, created_at DESC);
CREATE INDEX ON ad_actions (check_after) WHERE status = 'applied' AND check_result IS NULL;
