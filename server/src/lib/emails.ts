/** Шаблоны писем: HTML (с инлайн-стилями для почтовых клиентов) + текстовая версия. */
import { config } from './config.js';

const app = (hash: string) => `${config.publicUrl}/app/#${hash}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const rub = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₽';
const day = (d: Date | string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d)).replace(' г.', '');
const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

interface Part { title: string; intro: string[]; button?: { text: string; url: string }; after?: string[]; html?: string; text?: string; footer?: string; buttonLast?: boolean }

function render(p: Part) {
  const btn = p.button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="background:#2a78d6;border-radius:8px">
<a href="${esc(p.button.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${esc(p.button.text)}</a></td></tr></table>` : '';
  const para = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#222">${s}</p>`;
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f4f2;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e6e5e0">
<tr><td style="padding:22px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background:#2a78d6;border-radius:7px;text-align:center;color:#fff;font-weight:700;font-size:14px">П</td>
<td style="padding-left:10px;font-weight:700;font-size:16px;color:#0b0b0b">Пульс CRM</td></tr></table></td></tr>
<tr><td style="padding:22px 28px 8px">
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0b0b0b">${esc(p.title)}</h1>
${p.intro.map(para).join('')}
${p.html ?? ''}
${p.buttonLast ? '' : btn}
${(p.after ?? []).map(para).join('')}
${p.buttonLast ? btn : ''}
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #eeede8;font-size:12.5px;line-height:1.5;color:#898781">${p.footer ?? 'Это письмо отправлено автоматически сервисом Пульс CRM.'}</td></tr>
</table></td></tr></table></body></html>`;
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&laquo;|&raquo;/g, '"');
  const link = p.button ? `${p.button.text}: ${p.button.url}` : '';
  const text = [p.title, '', ...p.intro.map(strip), p.text ?? '', p.buttonLast ? '' : link, ...(p.after ?? []).map(strip), p.buttonLast ? link : '', '', '— Пульс CRM']
    .filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { html, text };
}

export function resetEmail(name: string, link: string) {
  return {
    subject: 'Восстановление пароля в Пульс CRM',
    ...render({
      title: 'Восстановление пароля',
      intro: [`${esc(name)}, мы получили запрос на смену пароля. Ссылка действует 1 час и сработает один раз.`],
      button: { text: 'Задать новый пароль', url: link },
      after: ['Если вы не запрашивали смену пароля, просто проигнорируйте это письмо — пароль останется прежним.'],
    }),
  };
}

export function inviteEmail(p: { inviter: string; company: string; role: string; link: string }) {
  return {
    subject: `${p.inviter} приглашает вас в «${p.company}» в Пульс CRM`,
    ...render({
      title: `Приглашение в «${p.company}»`,
      intro: [`${esc(p.inviter)} приглашает вас работать в Пульс CRM компании «${esc(p.company)}». Ваша роль: ${esc(p.role)}.`,
        'Перейдите по ссылке и задайте пароль — это займёт минуту. Приглашение действует 7 дней.'],
      button: { text: 'Принять приглашение', url: p.link },
    }),
  };
}

export function addedToTeamEmail(p: { inviter: string; company: string; role: string }) {
  return {
    subject: `Вас добавили в «${p.company}» в Пульс CRM`,
    ...render({
      title: `Вы в команде «${p.company}»`,
      intro: [`${esc(p.inviter)} добавил(а) вас в компанию «${esc(p.company)}». Ваша роль: ${esc(p.role)}.`,
        'Войдите своим обычным паролем и выберите компанию в меню слева внизу.'],
      button: { text: 'Войти', url: app('/login') },
    }),
  };
}

export function welcomeEmail(p: { name: string; company: string; snippet: string; trialEnds: Date | string }) {
  return {
    subject: 'Добро пожаловать в Пульс CRM — 3 шага до первого отчёта',
    ...render({
      title: `${p.name}, добро пожаловать!`,
      intro: [`Аккаунт «${esc(p.company)}» готов. Пробный период — до ${day(p.trialEnds)}, карта не нужна.`,
        '<b>1. Поставьте код на сайт</b> — в шапку всех страниц (на Tilda: Настройки сайта → Ещё → HTML-код для HEAD):'],
      html: `<pre style="margin:0 0 16px;padding:12px;background:#f4f4f2;border-radius:8px;font-size:12.5px;white-space:pre-wrap;word-break:break-all">${esc(p.snippet)}</pre>`,
      text: p.snippet,
      after: ['<b>2. Передавайте заказы</b> — кодом на странице «Спасибо за заказ» или из магазина по API. Инструкции — в разделе «Подключение».',
        '<b>3. Через неделю</b> пришлём отчёт: какие источники принесли выручку.',
        'Нужна помощь с подключением — просто ответьте на это письмо.'],
      button: { text: 'Открыть Пульс CRM', url: app('/integrations') },
      buttonLast: true,
    }),
  };
}

export function trialEndingEmail(p: { company: string; days: number; ends: Date | string }) {
  return {
    subject: `Пробный период заканчивается через ${p.days} ${p.days === 1 ? 'день' : p.days < 5 ? 'дня' : 'дней'}`,
    ...render({
      title: 'Пробный период скоро закончится',
      intro: [`Пробный период «${esc(p.company)}» заканчивается ${day(p.ends)}. Чтобы работа не прервалась, выберите тариф.`,
        'Если не оплатить, данные сохранятся, а статистика продолжит собираться — но доступ к панели будет приостановлен.'],
      button: { text: 'Выбрать тариф', url: app('/billing') },
    }),
  };
}

export function frozenEmail(p: { company: string; reason: 'trial' | 'paid' }) {
  return {
    subject: 'Доступ к Пульс CRM приостановлен',
    ...render({
      title: 'Доступ приостановлен',
      intro: [p.reason === 'trial' ? `Пробный период «${esc(p.company)}» закончился.` : `Оплаченный период «${esc(p.company)}» закончился.`,
        'Ничего не удалено: статистика с сайта продолжает собираться, публикации на сайте на месте. После оплаты всё станет доступно сразу.'],
      button: { text: 'Оплатить', url: app('/billing') },
    }),
  };
}

export function paymentSucceededEmail(p: { company: string; plan: string; amount: number; until: Date | string; renewal: boolean }) {
  return {
    subject: `Оплата получена: тариф «${p.plan}» до ${day(p.until)}`,
    ...render({
      title: 'Спасибо, оплата получена',
      intro: [`${p.renewal ? 'Автопродление прошло успешно. ' : ''}Тариф «${esc(p.plan)}» для «${esc(p.company)}» оплачен до <b>${day(p.until)}</b>. Сумма: ${rub(p.amount)}.`,
        'Кассовый чек приходит отдельным письмом от ЮKassa.'],
      button: { text: 'Тариф и платежи', url: app('/billing') },
    }),
  };
}

export function renewFailedEmail(p: { company: string; reason: string; until: Date | string }) {
  const why: Record<string, string> = {
    insufficient_funds: 'на карте недостаточно средств', card_expired: 'истёк срок действия карты',
    permission_revoked: 'разрешение на списание отозвано', expired_on_confirmation: 'платёж не был подтверждён',
  };
  return {
    subject: 'Не удалось продлить тариф Пульс CRM',
    ...render({
      title: 'Автопродление не прошло',
      intro: [`Не получилось списать оплату за «${esc(p.company)}»: ${esc(why[p.reason] ?? 'банк отклонил платёж')}.`,
        `Доступ оплачен до ${day(p.until)}, после этого действует 3 дня отсрочки. Оплатите картой, через СБП или по счёту.`],
      button: { text: 'Оплатить', url: app('/billing') },
    }),
  };
}

export function paidEndingEmail(p: { company: string; until: Date | string }) {
  return {
    subject: `Оплата Пульс CRM заканчивается ${day(p.until)}`,
    ...render({
      title: 'Оплаченный период заканчивается',
      intro: [`Тариф «${esc(p.company)}» оплачен до ${day(p.until)}. Автопродление выключено или карта не сохранена — продлите оплату, чтобы работа не прервалась.`],
      button: { text: 'Продлить', url: app('/billing') },
    }),
  };
}

export function invoiceEmail(p: { company: string; buyer: string; amount: number; plan: string }) {
  return {
    subject: `Счёт на оплату Пульс CRM — ${rub(p.amount)}`,
    ...render({
      title: 'Счёт выставлен',
      intro: [`Для «${esc(p.company)}» выставлен счёт на ${rub(p.amount)} (тариф «${esc(p.plan)}», плательщик ${esc(p.buyer)}).`,
        'Распечатать или сохранить счёт в PDF можно в разделе «Тариф и оплата». Доступ продлится после поступления денег — обычно 1–2 рабочих дня.'],
      button: { text: 'Открыть счёт', url: app('/billing') },
    }),
  };
}

export interface Digest {
  company: string; from: string; to: string;
  revenue: number; revenuePrev: number; orders: number; sessions: number; sessionsPrev: number; leads: number; conversion: number;
  sources: { label: string; revenue: number; sessions: number }[];
  exitPage: { path: string; rate: number } | null;
}

export function digestEmail(d: Digest, unsubscribe: string) {
  const row = (a: string, b: string, c = '') => `<tr><td style="padding:7px 0;border-bottom:1px solid #eeede8;font-size:14px;color:#222">${a}</td><td style="padding:7px 0;border-bottom:1px solid #eeede8;font-size:14px;text-align:right;font-weight:600;color:#0b0b0b">${b}</td><td style="padding:7px 0 7px 10px;border-bottom:1px solid #eeede8;font-size:12.5px;text-align:right;color:#52514e;white-space:nowrap">${c}</td></tr>`;
  const dRev = d.revenuePrev ? (d.revenue - d.revenuePrev) / d.revenuePrev : 0;
  const dSes = d.sessionsPrev ? (d.sessions - d.sessionsPrev) / d.sessionsPrev : 0;
  const top = d.sources.filter((s) => s.revenue > 0).slice(0, 5);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">
${row('Выручка', rub(d.revenue), d.revenuePrev ? `${pct(dRev)} к прошлой неделе` : '')}
${row('Заказы', String(d.orders))}
${row('Визиты', new Intl.NumberFormat('ru-RU').format(d.sessions), d.sessionsPrev ? `${pct(dSes)} к прошлой неделе` : '')}
${row('Заявки', String(d.leads))}
${row('Конверсия в заказ', `${(d.conversion * 100).toFixed(2).replace('.', ',')}%`)}
</table>
${top.length ? `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0b0b0b">Откуда пришли деньги</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${top.map((s) => row(esc(s.label), rub(s.revenue), `${s.sessions} визитов`)).join('')}</table>` : ''}
${d.exitPage ? `<p style="margin:0 0 14px;font-size:14px;color:#222">Чаще всего уходят со страницы <b>${esc(d.exitPage.path)}</b> — ${Math.round(d.exitPage.rate * 100)}% просмотров заканчиваются выходом. Стоит посмотреть, что на ней мешает.</p>` : ''}`;
  const text = [`Выручка: ${rub(d.revenue)}${d.revenuePrev ? ` (${pct(dRev)})` : ''}`, `Заказы: ${d.orders}`, `Визиты: ${d.sessions}`, `Заявки: ${d.leads}`,
    ...(top.length ? ['', 'Откуда пришли деньги:', ...top.map((s) => `— ${s.label}: ${rub(s.revenue)}`)] : [])].join('\n');
  return {
    subject: `${d.company}: ${rub(d.revenue)} выручки за неделю${d.revenuePrev ? ` (${pct(dRev)})` : ''}`,
    ...render({
      title: `Неделя ${d.from} — ${d.to}`,
      intro: [`Отчёт «${esc(d.company)}» за прошлую неделю.`],
      html, text,
      button: { text: 'Открыть сводку', url: app('/') },
      footer: `Еженедельный отчёт Пульс CRM. <a href="${esc(unsubscribe)}" style="color:#898781">Отписаться от отчёта</a>`,
    }),
  };
}

export const ROLE_NAMES: Record<string, string> = { owner: 'владелец', admin: 'администратор', manager: 'менеджер', viewer: 'наблюдатель' };
export { app as appLink };

export function adsReportEmail(p: { summary: string; applied: number; pending: number; failed: number }) {
  const parts = [
    p.applied ? `применено автоматически: ${p.applied}` : '',
    p.pending ? `ждут вашего решения: ${p.pending}` : '',
    p.failed ? `не удалось применить: ${p.failed}` : '',
  ].filter(Boolean);
  return {
    subject: p.pending ? `ИИ-агент по рекламе: ${p.pending} изменений ждут вашего решения` : 'ИИ-агент по рекламе: отчёт',
    ...render({
      title: 'Агент проверил вашу рекламу',
      intro: [esc(p.summary).replace(/\n/g, '<br>'), parts.length ? `Изменения: ${parts.join(', ')}.` : 'Изменений не потребовалось.'],
      button: { text: p.pending ? 'Посмотреть и решить' : 'Открыть отчёт', url: app('/ads') },
      after: ['Каждое изменение перед применением проверил контролёр, а через 2 дня он проверит результат и при ухудшении вернёт всё как было.'],
    }),
  };
}

export function adsRollbackEmail(p: { campaign: string; explanation: string }) {
  return {
    subject: `Контролёр отменил изменение в кампании «${p.campaign}»`,
    ...render({
      title: 'Изменение отменено автоматически',
      intro: [`Кампания «${esc(p.campaign)}».`, esc(p.explanation)],
      button: { text: 'Подробнее', url: app('/ads') },
    }),
  };
}
