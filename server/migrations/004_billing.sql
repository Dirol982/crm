-- Тарифы и оплата

ALTER TABLE tenants
  ADD COLUMN trial_ends_at        timestamptz NOT NULL DEFAULT now() + interval '14 days',
  ADD COLUMN paid_until           timestamptz,
  ADD COLUMN billing_period       text CHECK (billing_period IN ('month','year')),
  ADD COLUMN auto_renew           boolean NOT NULL DEFAULT true,
  ADD COLUMN payment_method_id    text,     -- сохранённая карта ЮKassa для автопродления
  ADD COLUMN payment_method_title text,     -- «Карта •••• 4242»
  ADD COLUMN billing_email        text;

-- plan: trial | start | business | pro | agency
UPDATE tenants SET plan = 'trial' WHERE plan NOT IN ('trial','start','business','pro','agency');

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('yookassa','invoice')),
  external_id      text UNIQUE,
  plan             text NOT NULL,
  period           text NOT NULL CHECK (period IN ('month','year')),
  amount           numeric(12,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'RUB',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','canceled')),
  is_renewal       boolean NOT NULL DEFAULT false,
  confirmation_url text,
  company          jsonb,                    -- реквизиты покупателя для счёта
  error            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz
);
CREATE INDEX ON payments (tenant_id, created_at DESC);
CREATE INDEX ON payments (status) WHERE status = 'pending';
