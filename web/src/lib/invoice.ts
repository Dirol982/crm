import { api } from './api';

const ONES = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const plural = (n: number, f: [string, string, string]) => {
  const a = n % 100, b = n % 10;
  return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2];
};
function triple(n: number, fem: boolean) {
  const out = [HUNDREDS[Math.floor(n / 100)]];
  const t = n % 100;
  if (t >= 10 && t < 20) out.push(TEENS[t - 10]);
  else out.push(TENS[Math.floor(t / 10)], ONES[fem ? 1 : 0][t % 10]);
  return out.filter(Boolean).join(' ');
}
/** 67104 → «Шестьдесят семь тысяч сто четыре рубля 00 копеек» */
export function rublesInWords(amount: number) {
  const rub = Math.floor(amount), kop = Math.round((amount - rub) * 100);
  const parts: string[] = [];
  const mln = Math.floor(rub / 1e6), th = Math.floor((rub % 1e6) / 1000), rest = rub % 1000;
  if (mln) parts.push(triple(mln, false), plural(mln, ['миллион', 'миллиона', 'миллионов']));
  if (th) parts.push(triple(th, true), plural(th, ['тысяча', 'тысячи', 'тысяч']));
  if (rest || !rub) parts.push(rest ? triple(rest, false) : 'ноль');
  const s = `${parts.join(' ')} ${plural(rub, ['рубль', 'рубля', 'рублей'])} ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`.replace(/\s+/g, ' ').trim();
  return s[0].toUpperCase() + s.slice(1);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (v: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** Открывает счёт в новой вкладке и предлагает распечатать / сохранить в PDF */
export async function printInvoice(id: string) {
  const w = window.open('', '_blank');
  const inv = await api(`/api/billing/invoice/${id}`);
  const s = inv.seller, c = inv.company ?? {};
  const d = new Date(inv.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const item = `Доступ к сервису «Пульс CRM», тариф «${inv.plan_name}», ${inv.period === 'year' ? '12 месяцев' : '1 месяц'}`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Счёт № ${esc(inv.number)} от ${esc(d)}</title>
<style>body{font:13px/1.45 Arial,sans-serif;color:#000;max-width:760px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #000;padding:4px 6px;vertical-align:top}.nb td{border:0;padding:2px 0}h1{font-size:18px;margin:20px 0 4px;padding-bottom:6px;border-bottom:2px solid #000}
.r{text-align:right}.muted{color:#444}button{margin:16px 0;padding:8px 14px;font:inherit}@media print{button{display:none}}</style></head><body>
<button onclick="print()">Распечатать или сохранить в PDF</button>
<table><tr><td colspan="2" rowspan="2" style="width:60%">${esc(s.bank)}<br><span class="muted">Банк получателя</span></td><td>БИК</td><td>${esc(s.bik)}</td></tr>
<tr><td>Сч. №</td><td>${esc(s.corr)}</td></tr>
<tr><td>ИНН ${esc(s.inn)}</td><td>КПП ${esc(s.kpp)}</td><td rowspan="2">Сч. №</td><td rowspan="2">${esc(s.account)}</td></tr>
<tr><td colspan="2">${esc(s.name)}<br><span class="muted">Получатель</span></td></tr></table>
<h1>Счёт на оплату № ${esc(inv.number)} от ${esc(d)}</h1>
<table class="nb"><tr><td style="width:110px">Поставщик:</td><td><b>${esc(s.name)}, ИНН ${esc(s.inn)}${s.kpp ? `, КПП ${esc(s.kpp)}` : ''}${s.address ? `, ${esc(s.address)}` : ''}</b></td></tr>
<tr><td>Покупатель:</td><td><b>${esc(c.name)}, ИНН ${esc(c.inn)}${c.kpp ? `, КПП ${esc(c.kpp)}` : ''}${c.address ? `, ${esc(c.address)}` : ''}</b></td></tr></table><br>
<table><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr>
<tr><td>1</td><td>${esc(item)}</td><td class="r">1</td><td>усл.</td><td class="r">${money(inv.amount)}</td><td class="r">${money(inv.amount)}</td></tr></table>
<table class="nb" style="margin-top:8px"><tr><td class="r"><b>Итого: ${money(inv.amount)} ₽</b></td></tr><tr><td class="r">Без НДС</td></tr></table>
<p>Всего наименований 1, на сумму ${money(inv.amount)} руб.<br><b>${esc(rublesInWords(inv.amount))}</b></p>
<p class="muted">В назначении платежа укажите: «Оплата по счёту № ${esc(inv.number)} от ${esc(d)}, ${esc(item)}». Счёт действителен 5 банковских дней.</p>
<p style="margin-top:40px">Поставщик ____________________ / ${esc(s.name)} /</p></body></html>`;
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
}
