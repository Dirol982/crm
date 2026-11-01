import type pg from 'pg';
import { one, pool, tx } from './db.js';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export interface CustomerInput { email?: string | null; name?: string | null; phone?: string | null; company?: string | null }

const normPhone = (p?: string | null) => (p ? p.replace(/[^\d+]/g, '').slice(0, 32) || null : null);

/** Найти или создать контакт по email/телефону. */
export async function upsertContact(db: Queryable, tenantId: string, c: CustomerInput, source?: string | null): Promise<string | null> {
  const email = c.email?.trim().toLowerCase() || null;
  const phone = normPhone(c.phone);
  if (!email && !phone) return null;
  let row = email
    ? (await db.query('SELECT id FROM contacts WHERE tenant_id=$1 AND lower(email)=$2', [tenantId, email])).rows[0]
    : (await db.query('SELECT id FROM contacts WHERE tenant_id=$1 AND phone=$2 LIMIT 1', [tenantId, phone])).rows[0];
  if (row) {
    await db.query(
      `UPDATE contacts SET name=COALESCE(name,$2), phone=COALESCE(phone,$3), company=COALESCE(company,$4), email=COALESCE(email,$5) WHERE id=$1`,
      [row.id, c.name || null, phone, c.company || null, email],
    );
    return row.id;
  }
  row = (await db.query(
    `INSERT INTO contacts(tenant_id,name,email,phone,company,source) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, lower(email)) WHERE email IS NOT NULL DO UPDATE SET name=COALESCE(contacts.name, EXCLUDED.name)
     RETURNING id`,
    [tenantId, c.name || null, email, phone, c.company || null, source || null],
  )).rows[0];
  return row.id;
}

export interface OrderInput {
  external_id?: string | null;
  amount: number;
  currency?: string | null;
  status?: 'pending' | 'paid' | 'cancelled' | 'refunded';
  items?: unknown[];
  customer?: CustomerInput;
  visitor_id?: string | null;
  session_id?: string | null;
  created_at?: string | null;
}

/** Создать/обновить заказ с атрибуцией к источнику визита. Идемпотентно по external_id. */
export async function recordOrder(tenantId: string, siteId: string | null, o: OrderInput) {
  return tx(async (c) => {
    // Атрибуция: сессия заказа -> последняя сессия посетителя
    let sess: any = null;
    if (siteId && o.session_id) {
      sess = (await c.query('SELECT id, visitor_id, source, medium, campaign FROM sessions WHERE site_id=$1 AND id=$2', [siteId, o.session_id])).rows[0];
    }
    if (!sess && siteId && o.visitor_id) {
      sess = (await c.query(
        'SELECT id, visitor_id, source, medium, campaign FROM sessions WHERE site_id=$1 AND visitor_id=$2 ORDER BY started_at DESC LIMIT 1',
        [siteId, o.visitor_id],
      )).rows[0];
    }
    const contactId = o.customer ? await upsertContact(c, tenantId, o.customer, sess?.source) : null;
    if (contactId && siteId && sess?.visitor_id) {
      await c.query('UPDATE visitors SET contact_id=$3 WHERE site_id=$1 AND id=$2 AND contact_id IS NULL', [siteId, sess.visitor_id, contactId]);
    }
    const res = await c.query(
      `INSERT INTO orders(tenant_id,site_id,external_id,contact_id,visitor_id,session_id,amount,currency,status,items,source,medium,campaign,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,(SELECT currency FROM tenants WHERE id=$1)),$9,$10,$11,$12,$13,COALESCE($14::timestamptz, now()))
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET amount=EXCLUDED.amount, status=EXCLUDED.status, items=EXCLUDED.items,
                     contact_id=COALESCE(orders.contact_id, EXCLUDED.contact_id)
       RETURNING id, (xmax = 0) AS created`,
      [
        tenantId, siteId, o.external_id || null, contactId, sess?.visitor_id ?? o.visitor_id ?? null, sess?.id ?? o.session_id ?? null,
        o.amount, o.currency?.toUpperCase() || null, o.status ?? 'paid', JSON.stringify(o.items ?? []),
        sess?.source ?? null, sess?.medium ?? null, sess?.campaign ?? null, o.created_at || null,
      ],
    );
    return res.rows[0] as { id: string; created: boolean };
  });
}

export async function siteByPublicKey(pk: string) {
  return one<{ id: string; tenant_id: string; domain: string | null }>('SELECT id, tenant_id, domain FROM sites WHERE public_key=$1', [pk]);
}

export { pool };
