export const STAGE_LABELS: Record<string, string> = {
  new: 'Новая', contacted: 'Контакт установлен', proposal: 'КП отправлено', negotiation: 'Переговоры', won: 'Успешно', lost: 'Проиграна',
};
export const stageLabel = (s: string) => STAGE_LABELS[s] ?? s;

export const STATUS_LABELS: Record<string, string> = { paid: 'Оплачен', pending: 'Ожидает', cancelled: 'Отменён', refunded: 'Возврат' };

export const MEDIUM_LABELS: Record<string, string> = {
  '(none)': 'прямой заход', organic: 'поиск', cpc: 'реклама', social: 'соцсети', referral: 'ссылка', newsletter: 'рассылка', email: 'рассылка', offline: 'офлайн',
};
export const sourceLabel = (source: string, medium?: string) => {
  if (source === '(direct)') return 'Прямые заходы';
  if (source === 'manual') return 'Вручную / офлайн';
  if (source === '(unknown)') return 'Не определён';
  return medium ? `${source} · ${MEDIUM_LABELS[medium] ?? medium}` : source;
};

export const DEVICE_LABELS: Record<string, string> = { desktop: 'Компьютер', mobile: 'Телефон', tablet: 'Планшет' };
export const ROLE_LABELS: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель' };
export const EVENT_LABELS: Record<string, string> = { lead: 'Заявка', add_to_cart: 'Добавление в корзину', purchase: 'Покупка' };

export const POST_STATUS: Record<string, { label: string; color: string }> = {
  idea: { label: 'Идея', color: 'var(--muted)' },
  draft: { label: 'Черновик', color: 'var(--axis)' },
  review: { label: 'На проверке', color: 'var(--warn)' },
  scheduled: { label: 'Запланировано', color: 'var(--accent)' },
  published: { label: 'Опубликовано', color: 'var(--good)' },
  archived: { label: 'В архиве', color: 'var(--muted)' },
};
export const POST_TYPE: Record<string, string> = { post: 'Публикация', page: 'Страница' };
