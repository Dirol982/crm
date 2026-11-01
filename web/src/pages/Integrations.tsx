import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Card, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useStore } from '../lib/store';

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? 'Скопировано ✓' : 'Копировать'}</button>;
}

function Code({ children }: { children: string }) {
  return <div style={{ position: 'relative' }}><pre>{children}</pre><div style={{ position: 'absolute', top: 6, right: 6 }}><Copy text={children} /></div></div>;
}

export default function Integrations() {
  const { sites, can, refresh } = useStore();
  const [sel, setSel] = useState(0);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'js' | 'events' | 'api' | 'content' | 'cms'>('js');
  const s = sites[sel] ?? sites[0];
  if (!s) return <PageHeader title="Подключение" filters={false} />;

  const rotate = async () => { if (confirm('Старый секретный ключ перестанет работать. Продолжить?')) { await api(`/api/sites/${s.id}/rotate-secret`, { method: 'POST' }); refresh(); } };

  return (
    <div className="stack">
      <PageHeader title="Подключение сайта" filters={false}>
        {sites.length > 1 && <select value={sel} onChange={(e) => setSel(+e.target.value)}>{sites.map((x, i) => <option key={x.id} value={i}>{x.name}</option>)}</select>}
        {can('admin') && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Добавить сайт</button>}
      </PageHeader>

      <Card title={s.name} sub={s.domain ? `Данные принимаются только с домена ${s.domain} и его поддоменов` : 'Домен не ограничен'}>
        <div className="grid g-2">
          <label className="field">Публичный ключ (для кода на сайте)<input readOnly value={s.public_key} onFocus={(e) => e.target.select()} /></label>
          {s.secret_key && (
            <label className="field">Секретный ключ (для серверного API — не публикуйте!)
              <div className="row"><input readOnly value={s.secret_key} onFocus={(e) => e.target.select()} style={{ flex: 1 }} /><button className="btn sm" onClick={rotate}>Сменить</button></div>
            </label>
          )}
        </div>
      </Card>

      <Card>
        <div className="tabs">
          <button className={tab === 'js' ? 'on' : ''} onClick={() => setTab('js')}>1. Код на сайт</button>
          <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>2. Заявки и покупки</button>
          <button className={tab === 'api' ? 'on' : ''} onClick={() => setTab('api')}>3. Серверный API</button>
          <button className={tab === 'content' ? 'on' : ''} onClick={() => setTab('content')}>4. Контент на сайте</button>
          <button className={tab === 'cms' ? 'on' : ''} onClick={() => setTab('cms')}>Tilda, WordPress, 1С…</button>
        </div>
        {tab === 'js' && (
          <div className="stack">
            <p style={{ margin: 0 }}>Вставьте код перед закрывающим тегом <code>&lt;/head&gt;</code> на всех страницах сайта. Сразу начнут собираться визиты, страницы, источники (UTM, реклама, поиск, соцсети), время на сайте, отказы и страницы выхода. Формы с email или телефоном автоматически становятся заявками.</p>
            <Code>{s.snippet}</Code>
            <p className="sub" style={{ margin: 0 }}>Атрибуты: <code>data-no-forms</code> — не собирать формы автоматически; <code>data-respect-dnt</code> — учитывать «Do Not Track». Одностраничные приложения (React, Vue) отслеживаются автоматически.</p>
          </div>
        )}
        {tab === 'events' && (
          <div className="stack">
            <p style={{ margin: 0 }}>Вызывайте из JavaScript на своём сайте — данные сразу попадут в CRM и привяжутся к визиту и источнику:</p>
            <Code>{`// Заявка (создаст клиента в CRM)
crm('lead', { name: 'Иван', email: 'ivan@mail.ru', phone: '+79001234567' });

// Покупка (на странице «Спасибо за заказ»)
crm('purchase', { id: 'ORDER-123', amount: 4990, email: 'ivan@mail.ru',
                  items: [{ name: 'Кроссовки', qty: 1, price: 4990 }] });

// Любое событие: клик, корзина, просмотр видео…
crm('event', 'add_to_cart', { sku: 'A-1' }, 4990);

// ID посетителя — передайте на сервер вместе с заказом для точной атрибуции
const { visitor, session } = crm('ids');`}</Code>
          </div>
        )}
        {tab === 'api' && (
          <div className="stack">
            <p style={{ margin: 0 }}>Самый надёжный способ передавать продажи — с сервера магазина при оплате. Повторная отправка с тем же <code>external_id</code> обновит заказ (например, статус «возврат»).</p>
            <Code>{`curl -X POST ${s.api_url}/orders \\
  -H "Authorization: Bearer ${s.secret_key ?? 'SECRET_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_id": "ORDER-123",
    "amount": 4990,
    "status": "paid",
    "customer": { "name": "Иван", "email": "ivan@mail.ru", "phone": "+79001234567" },
    "items": [{ "name": "Кроссовки", "qty": 1, "price": 4990 }],
    "visitor_id": "<из crm('ids').visitor>"
  }'`}</Code>
            <p className="sub" style={{ margin: 0 }}>Также доступны <code>POST /api/v1/contacts</code> (клиент/заявка) и <code>POST /api/v1/events</code> (события). Статусы заказа: paid, pending, cancelled, refunded.</p>
          </div>
        )}
        {tab === 'content' && (
          <div className="stack">
            <p style={{ margin: 0 }}>Публикации, страницы и блоки из раздела «Сайт» выводятся тем же кодом из шага 1 — добавьте в нужное место страницы контейнер:</p>
            <Code>{`<!-- Блог / новости: лента карточек; по клику открывается статья (?post=адрес) -->
<div data-crm-posts data-limit="9"></div>

<!-- Только новости с тегом -->
<div data-crm-posts data-tag="новости"></div>

<!-- Страница сайта, созданная в CRM («Доставка», «О компании»…) -->
<div data-crm-post data-type="page" data-slug="delivery"></div>

<!-- Баннер или объявление из раздела «Блоки сайта» -->
<div data-crm-block="top-banner"></div>`}</Code>
            <p className="sub" style={{ margin: 0 }}>
              Запланированные материалы появляются на сайте автоматически в назначенное время. Свой формат ссылок на статьи: <code>data-link="/blog/{'{slug}'}"</code>.
              Отключить стандартное оформление: <code>data-no-style</code> на теге скрипта. Просмотры статей видны в разделе «Публикации».
            </p>
            <div><b>Для разработчиков — JSON API</b> (без ключей, только опубликованное):</div>
            <Code>{`GET ${s.api_url.replace(/\/api\/v1$/, '')}/c/${s.public_key}/posts?limit=10&tag=новости
GET ${s.api_url.replace(/\/api\/v1$/, '')}/c/${s.public_key}/posts/{slug}?type=post|page
GET ${s.api_url.replace(/\/api\/v1$/, '')}/c/${s.public_key}/blocks
GET ${s.api_url.replace(/\/api\/v1$/, '')}/c/${s.public_key}/rss.xml?link=https://site.ru/blog/{slug}`}</Code>
          </div>
        )}
        {tab === 'cms' && (
          <div className="stack">
            <div><b>Tilda</b><p className="sub" style={{ margin: '4px 0' }}>Настройки сайта → Ещё → HTML-код для вставки в HEAD → вставьте код из шага 1. Заявки из форм Tilda подхватятся автоматически.</p></div>
            <div><b>WordPress / WooCommerce</b><p className="sub" style={{ margin: '4px 0' }}>Вставьте код в header.php темы или через плагин «Insert Headers and Footers». Для заказов — вебхук WooCommerce «Order paid» на {s.api_url}/orders.</p></div>
            <div><b>1С-Битрикс, InSales, OpenCart, свой движок</b><p className="sub" style={{ margin: '4px 0' }}>Код — в шаблон сайта. Заказы — запросом к серверному API (шаг 3) в обработчике оплаты.</p></div>
            <div><b>Офлайн-продажи, касса, звонки</b><p className="sub" style={{ margin: '4px 0' }}>Добавляйте вручную в разделе «Продажи» или передавайте через API — они попадут в общую выручку.</p></div>
          </div>
        )}
      </Card>
      {adding && <AddSite onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await refresh(); setSel(sites.length); }} />}
    </div>
  );
}

function AddSite({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/api/sites', { method: 'POST', body: { name, domain: domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null } });
    onDone();
  };
  return (
    <Modal title="Новый сайт" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">Название<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Интернет-магазин" /></label>
        <label className="field">Домен (необязательно)<input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="shop.ru" /></label>
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Создать</button></div>
      </form>
    </Modal>
  );
}
