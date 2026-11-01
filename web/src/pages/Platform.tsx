import { PageHeader } from '../components/Layout';
import { Card, Empty, Kpi, Loading } from '../components/ui';
import { api } from '../lib/api';
import { date, num } from '../lib/format';
import { useFetch } from '../lib/store';

const rub = (v: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
const PLAN: Record<string, string> = { trial: 'Пробный', start: 'Старт', business: 'Бизнес', pro: 'Про', agency: 'Агентство' };

function status(t: any) {
  const now = Date.now();
  if (t.paid_until && Date.parse(t.paid_until) > now) return { label: `оплачен до ${date(t.paid_until)}`, color: 'var(--good)' };
  if (!t.paid_until && Date.parse(t.trial_ends_at) > now) return { label: `пробный до ${date(t.trial_ends_at)}`, color: 'var(--accent)' };
  return { label: 'не оплачен', color: 'var(--bad)' };
}

/** Кабинет владельца SaaS: клиенты, выручка, счета юрлиц (доступ по SUPERADMIN_EMAILS) */
export default function Platform() {
  const { data, reload } = useFetch<any>('/api/admin/overview');
  if (!data) return <><PageHeader title="Платформа" filters={false} /><Loading /></>;
  const markPaid = async (id: string, name: string) => {
    if (!confirm(`Подтвердить поступление оплаты от «${name}»? Доступ будет продлён.`)) return;
    await api(`/api/admin/payments/${id}/mark-paid`, { method: 'POST' });
    reload();
  };
  const extend = async (id: string) => {
    const days = Number(prompt('На сколько дней продлить доступ?', '14'));
    if (days > 0) { await api(`/api/admin/tenants/${id}/extend`, { method: 'POST', body: { days } }); reload(); }
  };
  return (
    <div className="stack">
      <PageHeader title="Платформа" filters={false} />
      <div className="grid g-4 kpis">
        <Kpi label="Ежемесячная выручка" value={rub(data.totals.mrr)} />
        <Kpi label="Платящие компании" value={num(data.totals.paying)} />
        <Kpi label="На пробном периоде" value={num(data.totals.trials)} />
        <Kpi label="Всего компаний" value={num(data.totals.tenants)} />
      </div>
      <Card title="Счета юрлиц, ожидающие оплаты" sub="Отметьте, когда деньги поступят на расчётный счёт">
        {!data.invoices.length ? <Empty>Неоплаченных счетов нет</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Дата</th><th>Компания</th><th>Плательщик</th><th>Тариф</th><th className="num">Сумма</th><th></th></tr></thead>
            <tbody>{data.invoices.map((i: any) => (
              <tr key={i.id}><td>{date(i.created_at)}</td><td>{i.tenant_name}</td><td>{i.company?.name}<div className="sub">ИНН {i.company?.inn}</div></td>
                <td>{PLAN[i.plan]}, {i.period === 'year' ? 'год' : 'месяц'}</td><td className="num"><b>{rub(i.amount)}</b></td>
                <td className="num"><button className="btn sm primary" onClick={() => markPaid(i.id, i.tenant_name)}>Оплата поступила</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="Компании">
        <div className="table-wrap"><table>
          <thead><tr><th>Компания</th><th>Владелец</th><th>Тариф</th><th>Статус</th><th className="num">Сайты</th><th className="num">Оплачено всего</th><th>Регистрация</th><th></th></tr></thead>
          <tbody>{data.tenants.map((t: any) => {
            const s = status(t);
            return (
              <tr key={t.id}>
                <td><b>{t.name}</b></td><td className="trunc">{t.owner_email}</td>
                <td>{PLAN[t.plan] ?? t.plan}{t.billing_period === 'year' ? ' · год' : ''}{t.has_card && <span className="sub"> · карта</span>}</td>
                <td><span className="badge"><span className="dot" style={{ background: s.color }} />{s.label}</span></td>
                <td className="num">{t.sites}</td><td className="num">{rub(t.paid_total)}</td><td>{date(t.created_at)}</td>
                <td className="num"><button className="btn sm" onClick={() => extend(t.id)}>Продлить</button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
