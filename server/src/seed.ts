/**
 * Демо-данные: компания «Демо магазин», вход demo@example.com / demo12345.
 * 60 дней визитов, просмотров, заявок, заказов + контакты, сделки, задачи.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool, tx } from './lib/db.js';
import { migrate } from './migrate.js';
import { genKey } from './lib/util.js';

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: [T, number][]): T => {
  const total = arr.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of arr) if ((r -= w) < 0) return v;
  return arr[0][0];
};

const SOURCES: [[string, string, string | null], number][] = [
  [['(direct)', '(none)', null], 26],
  [['google', 'organic', null], 18],
  [['yandex', 'organic', null], 22],
  [['yandex', 'cpc', 'autumn_sale'], 14],
  [['vk.com', 'social', null], 8],
  [['telegram', 'social', 'channel_post'], 6],
  [['email', 'newsletter', 'november'], 4],
  [['partner-blog.ru', 'referral', null], 2],
];
const PAGES = ['/', '/catalog', '/catalog/shoes', '/catalog/bags', '/product/123', '/product/456', '/product/789', '/cart', '/checkout', '/about', '/delivery', '/contacts', '/blog/how-to-choose'];
const NAMES = ['Анна Смирнова', 'Иван Петров', 'Мария Козлова', 'Дмитрий Волков', 'Елена Новикова', 'Сергей Морозов', 'Ольга Соколова', 'Алексей Лебедев', 'Наталья Попова', 'Павел Кузнецов', 'Татьяна Васильева', 'Николай Фёдоров', 'Юлия Михайлова', 'Андрей Егоров', 'Екатерина Павлова'];

async function main() {
  await migrate();
  const exists = (await pool.query("SELECT 1 FROM users WHERE email='demo@example.com'")).rowCount;
  if (exists) {
    console.log('demo data already exists');
    return;
  }

  await tx(async (c) => {
    const t = (await c.query("INSERT INTO tenants(name, plan) VALUES ('Демо магазин','pro') RETURNING id")).rows[0].id;
    const u = (await c.query("INSERT INTO users(email,name,password_hash) VALUES ('demo@example.com','Демо Владелец',$1) RETURNING id", [await bcrypt.hash('demo12345', 10)])).rows[0].id;
    const m = (await c.query("INSERT INTO users(email,name,password_hash) VALUES ('manager@example.com','Мария Менеджер',$1) RETURNING id", [await bcrypt.hash('demo12345', 10)])).rows[0].id;
    await c.query("INSERT INTO memberships VALUES ($1,$2,'owner'), ($1,$3,'manager')", [t, u, m]);
    const site = (await c.query("INSERT INTO sites(tenant_id,name,domain,public_key,secret_key) VALUES ($1,'shop.example.com','shop.example.com',$2,$3) RETURNING id", [t, 'pk_demo', genKey('sk', 24)])).rows[0].id;

    const contactIds: string[] = [];
    for (let i = 0; i < 60; i++) {
      const name = NAMES[i % NAMES.length];
      const r = await c.query(
        'INSERT INTO contacts(tenant_id,name,email,phone,source,created_at,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [t, name, `client${i + 1}@mail.ru`, `+7900${String(1000000 + i * 7919).slice(0, 7)}`, pick(SOURCES)[0], new Date(Date.now() - rnd(0, 59) * 86400000), i % 2 ? u : m],
      );
      contactIds.push(r.rows[0].id);
    }

    const sess: unknown[][] = [];
    const pvs: unknown[][] = [];
    const evs: unknown[][] = [];
    const ords: unknown[][] = [];
    for (let day = 59; day >= 0; day--) {
      const weekday = new Date(Date.now() - day * 86400000).getDay();
      const base = (weekday === 0 || weekday === 6 ? 70 : 110) + (60 - day) * 1.2;
      const n = Math.round(base * (0.85 + Math.random() * 0.3));
      for (let i = 0; i < n; i++) {
        const start = new Date(Date.now() - day * 86400000 - rnd(0, 86000) * 1000);
        if (start > new Date()) continue;
        const [source, medium, campaign] = pick(SOURCES);
        const sid = randomUUID();
        const vid = Math.random() < 0.25 ? `v-${rnd(1, 400)}` : randomUUID();
        const bounce = Math.random() < (medium === 'cpc' ? 0.52 : medium === 'social' ? 0.6 : 0.38);
        const pages = bounce ? 1 : rnd(2, 9);
        let path = pick([['/', 40], ['/catalog', 20], ['/product/123', 15], ['/blog/how-to-choose', 10], ['/delivery', 5], ['/catalog/shoes', 10]] as [string, number][]);
        let ts = start.getTime();
        let dur = 0;
        let last = path;
        for (let p = 0; p < pages; p++) {
          const d = bounce ? rnd(2, 25) : rnd(8, 140);
          pvs.push([site, sid, vid, randomUUID(), path, new Date(ts), d]);
          ts += d * 1000;
          dur += d;
          last = path;
          path = PAGES[rnd(0, PAGES.length - 1)];
        }
        let events = 0;
        if (!bounce && Math.random() < 0.06) {
          events++;
          evs.push([site, sid, vid, 'lead', last, null, new Date(ts)]);
        }
        if (!bounce && Math.random() < 0.15) {
          events++;
          evs.push([site, sid, vid, 'add_to_cart', '/product/123', null, new Date(ts)]);
        }
        if (!bounce && Math.random() < (medium === 'cpc' ? 0.05 : 0.035)) {
          events++;
          const amount = rnd(9, 160) * 100;
          ords.push([t, site, `ORD-${10000 + ords.length}`, contactIds[rnd(0, contactIds.length - 1)], vid, sid, amount,
            Math.random() < 0.92 ? 'paid' : pick([['refunded', 1], ['cancelled', 1]] as [string, number][]),
            JSON.stringify([{ name: 'Товар', qty: 1, price: amount }]), source, medium, campaign, new Date(ts)]);
        }
        sess.push([site, sid, vid, start, new Date(ts), pvs[pvs.length - pages][4], last, source, medium, campaign,
          pick([['desktop', 52], ['mobile', 42], ['tablet', 6]] as [string, number][]),
          pick([['Chrome', 45], ['Yandex', 25], ['Safari', 18], ['Firefox', 6], ['Edge', 6]] as [string, number][]),
          pick([['Windows', 40], ['Android', 30], ['iOS', 18], ['macOS', 10], ['Linux', 2]] as [string, number][]),
          pages, events, dur]);
      }
    }

    const insertMany = async (sql: string, rows: unknown[][], cols: number) => {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const values = chunk.map((_, r) => `(${Array.from({ length: cols }, (_, k) => `$${r * cols + k + 1}`).join(',')})`).join(',');
        await c.query(`${sql} VALUES ${values}`, chunk.flat());
      }
    };
    const visitorIds = [...new Set(sess.map((s) => s[2] as string))];
    await insertMany('INSERT INTO visitors(site_id,id)', visitorIds.map((v) => [site, v]), 2);
    await insertMany('INSERT INTO sessions(site_id,id,visitor_id,started_at,last_activity_at,landing_page,exit_page,source,medium,campaign,device,browser,os,pageviews,events,duration_sec)', sess, 16);
    await insertMany('INSERT INTO pageviews(site_id,session_id,visitor_id,pv_id,path,ts,duration_sec)', pvs, 7);
    await insertMany('INSERT INTO events(site_id,session_id,visitor_id,name,path,value,ts)', evs, 7);
    await insertMany('INSERT INTO orders(tenant_id,site_id,external_id,contact_id,visitor_id,session_id,amount,status,items,source,medium,campaign,created_at)', ords, 13);
    // офлайн-продажи
    for (let i = 0; i < 25; i++) {
      await c.query("INSERT INTO orders(tenant_id,amount,status,source,medium,contact_id,created_at) VALUES ($1,$2,'paid','manual','offline',$3,$4)",
        [t, rnd(20, 300) * 100, contactIds[rnd(0, contactIds.length - 1)], new Date(Date.now() - rnd(0, 59) * 86400000)]);
    }

    const stages = ['new', 'contacted', 'proposal', 'negotiation', 'won', 'lost'];
    const titles = ['Оптовый заказ', 'Корпоративный подарок', 'Поставка в филиал', 'Годовой контракт', 'Пробная партия', 'Сервисное обслуживание'];
    for (let i = 0; i < 24; i++) {
      const stage = stages[i % stages.length];
      await c.query('INSERT INTO deals(tenant_id,contact_id,title,amount,stage,owner_id,closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [t, contactIds[i], `${titles[i % titles.length]} #${i + 1}`, rnd(30, 900) * 1000, stage, i % 2 ? u : m, ['won', 'lost'].includes(stage) ? new Date() : null]);
    }
    const tasks = ['Перезвонить клиенту', 'Отправить КП', 'Уточнить адрес доставки', 'Выставить счёт', 'Напомнить об оплате', 'Собрать отзыв'];
    for (let i = 0; i < 12; i++) {
      await c.query('INSERT INTO tasks(tenant_id,title,due_at,done,assignee_id,contact_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [t, tasks[i % tasks.length], new Date(Date.now() + (i - 4) * 86400000), i < 3, i % 2 ? u : m, contactIds[i]]);
    }
    console.log(`seeded: ${sess.length} sessions, ${pvs.length} pageviews, ${ords.length} web orders`);
  });
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
