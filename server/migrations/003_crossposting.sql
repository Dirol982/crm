-- Кросспостинг публикаций в Telegram и VK

-- Шаблон ссылки на статью на сайте клиента, например https://shop.ru/blog/{slug}
ALTER TABLE sites ADD COLUMN post_url_template text;

-- Свой текст для соцсетей (если пусто — заголовок + анонс + ссылка)
ALTER TABLE posts ADD COLUMN social_text text;

CREATE TABLE channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('telegram','vk')),
  name       text NOT NULL,
  target     text NOT NULL,          -- telegram: @channel или -100…; vk: id сообщества
  secret     text NOT NULL,          -- токен бота / сообщества, зашифрован (AES-256-GCM)
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON channels (tenant_id);

CREATE TABLE post_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  external_url    text,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, channel_id)
);
CREATE INDEX ON post_deliveries (status, next_attempt_at) WHERE status IN ('pending','sending');
