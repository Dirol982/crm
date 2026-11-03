import { q } from '../db.js';
import { tenantState } from '../billing.js';
import { aiEnabled, runMonitor, runOptimizer } from './agent.js';
import { syncAccount } from './core.js';

type Log = { info: (m: string) => void; error: (e: unknown) => void };

/**
 * Каждые 15 минут:
 *  - проверка результата применённых изменений (без ИИ, работает всегда);
 *  - синхронизация кабинетов, не обновлявшихся 6 часов;
 *  - раз в сутки — анализ агентом для компаний, где он включён (нужен ключ Claude).
 * Компании с приостановленной оплатой пропускаются.
 */
export function scheduleAds(log: Log) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runMonitor().catch((e) => log.error(e));
      const stale = await q(`SELECT id FROM ad_accounts WHERE active AND platform IN ('yandex','vk','google') AND (last_sync_at IS NULL OR last_sync_at < now() - interval '6 hours') LIMIT 20`);
      for (const a of stale) await syncAccount(a.id).catch(() => { /* ошибка записана в sync_error */ });
      if (!aiEnabled()) return;
      const due = await q(
        `SELECT DISTINCT c.tenant_id FROM ad_campaigns c
         JOIN ad_policies p ON p.tenant_id=c.tenant_id AND p.mode <> 'off'
         WHERE NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.tenant_id=c.tenant_id AND r.kind='optimize' AND r.started_at > now() - interval '24 hours')
         LIMIT 100`,
      );
      let started = 0;
      for (const t of due) {
        if (started >= 5) break; // не больше 5 анализов за проход — остальные в следующие 15 минут
        // приостановленные компании и тарифы без ИИ-агента пропускаем
        if (!(await tenantState(t.tenant_id)).ai) continue;
        started++;
        await runOptimizer(t.tenant_id, 'schedule').catch((e) => log.error(e));
      }
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
