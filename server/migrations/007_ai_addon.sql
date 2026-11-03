-- ИИ-агент рекламы входит в «Бизнес» и выше; к «Старту» докупается опцией
ALTER TABLE tenants ADD COLUMN ai_addon boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN ai_addon boolean NOT NULL DEFAULT false;
