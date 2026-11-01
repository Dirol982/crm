-- Контент сайта: публикации (блог/новости), статичные страницы, блоки (баннеры, объявления), файлы.

CREATE TABLE posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'post' CHECK (type IN ('post','page')),
  title           text NOT NULL,
  slug            text NOT NULL,
  excerpt         text,
  content         text NOT NULL DEFAULT '',
  cover_url       text,
  tags            text[] NOT NULL DEFAULT '{}',
  -- idea → draft → review → scheduled → published (→ archived)
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('idea','draft','review','scheduled','published','archived')),
  publish_at      timestamptz,   -- запланированное время публикации
  published_at    timestamptz,   -- фактическое время публикации
  seo_title       text,
  seo_description text,
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, type, slug)
);
CREATE INDEX ON posts (tenant_id, status, publish_at);
CREATE INDEX ON posts (site_id, type, status, published_at DESC);
CREATE INDEX ON posts (status, publish_at) WHERE status = 'scheduled';

CREATE TABLE content_blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key        text NOT NULL,               -- место на сайте: <div data-crm-block="key">
  title      text NOT NULL,
  html       text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT true,
  starts_at  timestamptz,                 -- показывать с
  ends_at    timestamptz,                 -- показывать до
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, key)
);

CREATE TABLE uploads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename   text NOT NULL,
  mime       text NOT NULL,
  size       int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
