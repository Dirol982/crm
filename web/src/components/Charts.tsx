import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dayLabel } from '../lib/format';

const axisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--muted)', fontSize: 11.5 },
  tickLine: false,
};

function Tip({ active, payload, label, fmt, name }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      <div className="tt-title">{dayLabel(label)}</div>
      <div className="tt-row"><span>{name}</span><b>{fmt(payload[0].value)}</b></div>
    </div>
  );
}

/** Одна метрика во времени (без второй оси — разные метрики идут отдельными графиками) */
export function TimeChart({ data, dataKey, name, fmt, height = 220, kind = 'area' }: {
  data: any[]; dataKey: string; name: string; fmt: (v: number) => string; height?: number; kind?: 'area' | 'bar';
}) {
  const yFmt = (v: number) => fmt(v).replace(/\s?₽/, '').replace(/,0+%/, '%');
  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === 'area' ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" {...axisProps} tickFormatter={dayLabel} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={yFmt} />
          <Tooltip content={<Tip fmt={fmt} name={name} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
          <Area type="monotone" dataKey={dataKey} stroke="var(--series-1)" strokeWidth={2} fill={`url(#g-${dataKey})`}
            activeDot={{ r: 4.5, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--series-1)' }} isAnimationActive={false} />
        </AreaChart>
      ) : (
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" {...axisProps} tickFormatter={dayLabel} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={yFmt} />
          <Tooltip content={<Tip fmt={fmt} name={name} />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar dataKey={dataKey} fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** Воронка: упорядоченные шаги — одна гамма от светлого к тёмному, подписи прямо на строках */
export function Funnel({ steps }: { steps: { label: string; value: number; fmt: string }[] }) {
  const max = steps[0]?.value || 1;
  const shades = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'];
  return (
    <div>
      {steps.map((s, i) => {
        const rate = i > 0 ? s.value / max : null;
        return (
          <div className="funnel-row" key={s.label} title={`${s.label}: ${s.fmt}`}>
            <span style={{ fontWeight: 550 }}>{s.label}</span>
            <div style={{ background: 'var(--surface-2)', borderRadius: 4 }}>
              <div className="funnel-bar" style={{ width: `${Math.max(1, (s.value / max) * 100)}%`, background: shades[i % shades.length] }} />
            </div>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              <b>{s.fmt}</b>
              {rate !== null && <div className="sub">{(rate * 100).toFixed(1).replace('.', ',')}% визитов</div>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Горизонтальные столбцы для разбивки по категориям (одна метрика, один цвет) */
export function HBars({ rows, fmt }: { rows: { label: string; value: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${fmt(r.value)}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
            <span>{r.label}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.value)}</b>
          </div>
          <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4 }}>
            <div style={{ height: 8, width: `${(r.value / max) * 100}%`, background: 'var(--series-1)', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
