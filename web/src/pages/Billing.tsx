import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Loading, Modal } from '../components/ui';
import { api } from '../lib/api';
import { date, num } from '../lib/format';
import { useFetch, useStore } from '../lib/store';
import { printInvoice } from '../lib/invoice';

const rub = (v: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
const STATUS: Record<string, { label: string; color: string }> = {
  trial: { label: 'Пробный период', color: 'var(--accent)' },
  active: { label: 'Оплачен', color: 'var(--good)' },
  grace: { label: 'Срок оплаты истёк', color: 'var(--warn)' },
  frozen: { label: 'Приостановлен', color: 'var(--bad)' },
  unlimited: { label: 'Без ограничений', color: 'var(--good)' },
};
const PAY_STATUS: Record<string, string> = { pending: 'Ожидает оплаты', succeeded: '✓ Оплачен', canceled: 'Отменён' };

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const share = Math.min(1, used / Math.max(limit, 1));
  const over = used >= limit;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: over ? 'var(--bad)' : undefined }}>{over && '⚠ '}{num(used)} из {limit >= 1000 && label === 'Сотрудники' ? 'без лимита' : num(limit)}</span>
      </div>
      <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, marginTop: 4 }}>
        <div style={{ height: 8, width: `${Math.max(1, share * 100)}%`, background: over ? 'var(--bad)' : share > 0.8 ? 'var(--warn)' : 'var(--series-1)', borderRadius: 4 }} />
      </div>
    </div>
  );
}

export default function Billing() {
  const { can, refresh } = useStore();
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useFetch<any>('/api/billing');
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [returned, setReturned] = useState<'' | 'checking' | 'succeeded' | 'canceled' | 'pending'>('');
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const [addon, setAddon] = useState<boolean | null>(null); // опция «ИИ-агент» для тарифов, куда он не входит
  const admin = can('admin');

  // Возврат со страницы оплаты ЮKassa: ?payment=<id> — сверяем статус, пока не станет известен
  const paymentId = sp.get('payment');
  useEffect(() => {
    if (!paymentId) return;
    let tries = 0, alive = true;
    setReturned('checking');
    const check = async () => {
      const r = await api(`/api/billing/payments/${paymentId}/refresh`, { method: 'POST' }).catch(() => null);
      if (!alive) return;
      if (r?.status === 'succeeded' || r?.status === 'canceled') {
        setReturned(r.status); reload(); refresh();
        setSp({}, { replace: true });
      } else if (++tries < 15) setTimeout(check, 2000);
      else setReturned('pending');
    };
    check();
    return () => { alive = false; };
  }, [paymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <><PageHeader title="Тариф и оплата" filters={false} /><Loading /></>;
  if (!data.enabled) {
    return (
      <div className="stack">
        <PageHeader title="Тариф и оплата" filters={false} />
        <Card><Empty>Оплата не подключена — система работает без ограничений. Чтобы принимать оплату, задайте ключи ЮKassa на сервере (см. README).</Empty></Card>
      </div>
    );
  }
  const st = data.state, s = STATUS[st.status];
  const currentPlan = data.plans.find((p: any) => p.id === st.plan);

  const addonOn = addon ?? !!data.settings.ai_addon;
  const withAddon = (p: any) => !p.ai && addonOn;
  const priceOf = (p: any) => (period === 'year' ? p.price_year : p.price_month) + (withAddon(p) ? Math.round(data.ai_addon_price * (period === 'year' ? 12 * (1 - data.year_discount) : 1)) : 0);

  const checkout = async (plan: string) => {
    setErr(''); setBusy(plan);
    try {
      const p = data.plans.find((x: any) => x.id === plan);
      const r = await api('/api/billing/checkout', { method: 'POST', body: { plan, period, ai_addon: withAddon(p) } });
      location.href = r.confirmation_url; // страница оплаты ЮKassa: карта, СБП, SberPay
    } catch (e: any) {
      setErr(e.message === 'payment_provider' ? 'Платёжная система сейчас недоступна, попробуйте через несколько минут' : 'Не удалось создать платёж');
      setBusy(null);
    }
  };
  const saveSettings = async (body: any) => { await api('/api/billing/settings', { method: 'PATCH', body }); reload(); };

  return (
    <div className="stack">
      <PageHeader title="Тариф и оплата" filters={false} />

      {returned === 'checking' && <div className="demo-banner">Проверяем оплату…</div>}
      {returned === 'succeeded' && <div className="demo-banner" style={{ borderColor: 'var(--good)' }}><b>✓ Оплата прошла.</b> Спасибо! Тариф продлён.</div>}
      {returned === 'canceled' && <div className="demo-banner" style={{ borderColor: 'var(--bad)' }}><b>Оплата не прошла.</b> Деньги не списаны — попробуйте другой картой или через СБП.</div>}
      {returned === 'pending' && <div className="demo-banner">Платёж ещё обрабатывается. Статус обновится автоматически в течение нескольких минут.</div>}
      {st.status === 'frozen' && returned !== 'succeeded' && (
        <div className="demo-banner" style={{ borderColor: 'var(--bad)' }}>
          <b>Доступ к CRM приостановлен.</b> Статистика с сайта продолжает собираться, а публикации — показываться на сайте. Выберите тариф, чтобы продолжить работу.
        </div>
      )}

      <div className="grid g-2">
        <Card title="Текущий тариф">
          <div className="stack" style={{ gap: 12 }}>
            <div className="row">
              <span style={{ fontSize: 22, fontWeight: 650 }}>{st.status === 'trial' ? 'Пробный период' : currentPlan?.name ?? '—'}{st.status !== 'trial' && st.ai_addon ? ' + ИИ-агент' : ''}</span>
              <span className="badge"><span className="dot" style={{ background: s.color }} />{s.label}</span>
            </div>
            <div className="sub">
              {st.status === 'trial' && <>Бесплатно до {date(st.trial_ends_at)} — осталось {st.days_left} дн. Пока действуют лимиты тарифа «Бизнес».</>}
              {st.status === 'active' && <>Оплачено до {date(st.paid_until)}{data.settings.auto_renew && data.settings.payment_method_title ? ` · продлится автоматически (${data.settings.payment_method_title})` : ''}</>}
              {st.status === 'grace' && <>Оплата закончилась {date(st.paid_until)}. Доступ сохранится ещё {st.days_left} дн.</>}
              {st.status === 'frozen' && <>Оплатите тариф, чтобы вернуть доступ. Данные сохранены.</>}
            </div>
            {admin && data.settings.payment_method_title && (
              <div className="row" style={{ fontSize: 13 }}>
                <label className="row"><input type="checkbox" checked={data.settings.auto_renew} onChange={(e) => saveSettings({ auto_renew: e.target.checked })} /> Автопродление</label>
                <span className="sub">{data.settings.payment_method_title}</span>
                <button className="btn sm" onClick={() => confirm('Удалить сохранённую карту? Автопродление перестанет работать.') && saveSettings({ remove_card: true })}>Удалить карту</button>
              </div>
            )}
            {admin && <BillingEmail value={data.settings.billing_email} onSave={(v) => saveSettings({ billing_email: v })} />}
          </div>
        </Card>
        <Card title="Использование" sub="Визиты считаются с 1-го числа месяца">
          {st.limits ? (
            <div className="stack" style={{ gap: 14 }}>
              <Meter label="Визиты в этом месяце" used={data.usage.visits} limit={st.limits.visits} />
              <Meter label="Сайты" used={data.usage.sites} limit={st.limits.sites} />
              <Meter label="Сотрудники" used={data.usage.users} limit={st.limits.users} />
              {data.usage.visits >= st.limits.visits && <div className="sub" style={{ color: 'var(--bad)' }}>Лимит визитов превышен. Статистика продолжает собираться — перейдите на тариф выше, чтобы не потерять доступ.</div>}
            </div>
          ) : <Empty>Лимиты появятся после выбора тарифа</Empty>}
        </Card>
      </div>

      <Card title="Тарифы" action={
        <div className="seg">
          <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Помесячно</button>
          <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>За год −{Math.round(data.year_discount * 100)}%</button>
        </div>
      }>
        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="grid g-4">
          {data.plans.map((p: any) => {
            const current = st.status !== 'trial' && st.plan === p.id;
            const price = priceOf(p);
            return (
              <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderColor: current ? 'var(--accent)' : undefined, borderWidth: current ? 2 : 1 }}>
                <div className="row"><b style={{ fontSize: 16 }}>{p.name}</b>{current && <span className="badge">ваш тариф</span>}</div>
                <div><span style={{ fontSize: 24, fontWeight: 650 }}>{rub(price)}</span><span className="sub"> / {period === 'year' ? 'год' : 'месяц'}</span></div>
                {period === 'year' && <div className="sub">{rub(Math.round(price / 12))} в месяц вместо {rub(p.price_month + (withAddon(p) ? data.ai_addon_price : 0))}</div>}
                <div className="sub">{p.note}</div>
                <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                  <li>{num(p.visits)} визитов в месяц</li>
                  <li>{p.sites} {p.sites === 1 ? 'сайт' : p.sites < 5 ? 'сайта' : 'сайтов'}</li>
                  <li>{p.users >= 1000 ? 'Сотрудники без лимита' : `${p.users} сотрудников`}</li>
                  <li>Аналитика, CRM, публикации, соцсети</li>
                  {p.ai ? <li><b>ИИ-агент для рекламы</b></li> : <li className="muted">ИИ-агент — опцией</li>}
                </ul>
                {!p.ai && admin && (
                  <label className="row" style={{ fontSize: 13, alignItems: 'flex-start', gap: 6, flexWrap: 'nowrap', cursor: 'pointer' }}>
                    <input type="checkbox" checked={addonOn} onChange={(e) => setAddon(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>Добавить ИИ-агента для рекламы — +{rub(data.ai_addon_price)} в месяц</span>
                  </label>
                )}
                <span className="spacer" />
                {admin ? (
                  <>
                    <button className={`btn ${current ? '' : 'primary'}`} style={{ justifyContent: 'center' }} disabled={!!busy} onClick={() => checkout(p.id)}>
                      {busy === p.id ? 'Переходим к оплате…' : current ? 'Продлить' : 'Оплатить картой или СБП'}
                    </button>
                    {data.invoices && <button className="btn sm" style={{ justifyContent: 'center' }} onClick={() => setInvoiceFor(p.id)}>Счёт для юрлица</button>}
                  </>
                ) : <span className="sub">Оплату проводит владелец или администратор</span>}
              </div>
            );
          })}
        </div>
        <p className="sub" style={{ marginBottom: 0 }}>Оплата через ЮKassa. Карта сохраняется для автопродления — его можно выключить в любой момент. Чек придёт на почту.</p>
      </Card>

      <Card title="История платежей">
        {!data.payments.length ? <Empty>Платежей пока не было</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Дата</th><th>Тариф</th><th>Способ</th><th>Статус</th><th className="num">Сумма</th><th></th></tr></thead>
            <tbody>{data.payments.map((p: any) => (
              <tr key={p.id}>
                <td>{date(p.paid_at ?? p.created_at, true)}</td>
                <td>{data.plans.find((x: any) => x.id === p.plan)?.name ?? p.plan}{p.ai_addon ? ' + ИИ-агент' : ''}, {p.period === 'year' ? 'год' : 'месяц'}{p.is_renewal && <span className="sub"> · автопродление</span>}</td>
                <td>{p.provider === 'invoice' ? `Счёт · ${p.company?.name ?? ''}` : 'Карта / СБП'}</td>
                <td title={p.error ?? ''}>{PAY_STATUS[p.status]}{p.status === 'canceled' && p.error && <div className="sub">{p.error}</div>}</td>
                <td className="num"><b>{rub(p.amount)}</b></td>
                <td className="num">{p.provider === 'invoice' && <button className="btn sm" onClick={() => printInvoice(p.id)}>Счёт</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {invoiceFor && <InvoiceForm plan={invoiceFor} period={period} aiAddon={withAddon(data.plans.find((x: any) => x.id === invoiceFor))} onClose={() => setInvoiceFor(null)} onDone={(id) => { setInvoiceFor(null); reload(); printInvoice(id); }} />}
    </div>
  );
}

function BillingEmail({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [v, setV] = useState(value ?? '');
  return (
    <label className="field">Почта для чеков и счетов
      <div className="row"><input type="email" value={v} onChange={(e) => setV(e.target.value)} placeholder="по умолчанию — почта плательщика" style={{ flex: 1 }} />
        {v !== (value ?? '') && <button className="btn sm" onClick={() => onSave(v)}>Сохранить</button>}</div>
    </label>
  );
}

function InvoiceForm({ plan, period, aiAddon, onClose, onDone }: { plan: string; period: 'month' | 'year'; aiAddon: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ name: '', inn: '', kpp: '', address: '' });
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api('/api/billing/invoice', { method: 'POST', body: { plan, period, ai_addon: aiAddon, company: f } });
      onDone(r.id);
    } catch { setErr('Проверьте реквизиты: ИНН — 10 или 12 цифр, КПП — 9 цифр'); }
  };
  return (
    <Modal title="Счёт для юридического лица" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">Название организации<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ООО «Ромашка»" /></label>
        <div className="form cols">
          <label className="field">ИНН<input required inputMode="numeric" pattern="\d{10}|\d{12}" value={f.inn} onChange={(e) => setF({ ...f, inn: e.target.value.trim() })} /></label>
          <label className="field">КПП (для ООО)<input inputMode="numeric" pattern="\d{9}" value={f.kpp} onChange={(e) => setF({ ...f, kpp: e.target.value.trim() })} /></label>
        </div>
        <label className="field">Юридический адрес<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <p className="sub" style={{ margin: 0 }}>Доступ продлится после поступления оплаты на счёт — обычно 1–2 рабочих дня.</p>
        {err && <div className="error">{err}</div>}
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Выставить счёт</button></div>
      </form>
    </Modal>
  );
}
