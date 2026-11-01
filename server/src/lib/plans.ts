/** Тарифы. Отличаются лимитами, а не функциями: ценность видна с первого дня. */
export type PlanId = 'start' | 'business' | 'pro' | 'agency';

export interface Plan { id: PlanId; name: string; price: number; visits: number; sites: number; users: number; note: string }

export const PLANS: Record<PlanId, Plan> = {
  start: { id: 'start', name: 'Старт', price: 990, visits: 10_000, sites: 1, users: 2, note: 'Услуги, небольшой магазин' },
  business: { id: 'business', name: 'Бизнес', price: 2990, visits: 100_000, sites: 3, users: 10, note: 'Магазин с рекламой и соцсетями' },
  pro: { id: 'pro', name: 'Про', price: 6990, visits: 500_000, sites: 10, users: 1000, note: 'Несколько направлений, API' },
  agency: { id: 'agency', name: 'Агентство', price: 14990, visits: 1_000_000, sites: 30, users: 1000, note: 'Веб-студии: много клиентов' },
};

export const TRIAL_PLAN: PlanId = 'business';
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;          // после окончания оплаты аккаунт ещё работает 3 дня
export const YEAR_DISCOUNT = 0.2;     // −20% при оплате за год

export const isPlan = (p: string): p is PlanId => p in PLANS;

export function priceFor(plan: PlanId, period: 'month' | 'year') {
  const m = PLANS[plan].price;
  return period === 'year' ? Math.round(m * 12 * (1 - YEAR_DISCOUNT)) : m;
}
