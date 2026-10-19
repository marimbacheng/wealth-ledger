import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, pct } from './format';

// 圖表顏色只用驗證過的兩個分類色（series-1 藍、series-2 橘），其餘一律是文字與格線色票。
const C = {
  s1: 'var(--series-1)',
  s2: 'var(--series-2)',
  grid: 'var(--grid)',
  axis: 'var(--axis)',
  muted: 'var(--muted)',
};
const tick = { fill: C.muted, fontSize: 11 };
const compact = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${n.toFixed(0)}`);

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }[];
}

function Tip({ active, label, payload, extra }: TipProps & { extra?: (p: Record<string, unknown>) => string | undefined }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  return (
    <div className="chart-tip">
      <div className="t">{label}</div>
      {payload.map((p) => (
        <div key={p.name}>
          <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color, marginRight: 6 }} />
          {p.name}：{money(p.value)}
        </div>
      ))}
      {extra?.(row) && <div className="muted">{extra(row)}</div>}
    </div>
  );
}

// 單一序列水平長條：持股比例、產業分布（類別多，不用圓餅）
export function WeightBars({ data, label }: { data: { name: string; value: number; weight: number }[]; label: string }) {
  const h = Math.max(120, data.length * 26 + 30);
  const rows = data.map((d) => ({ ...d, share: pct(d.weight, 1) }));
  return (
    <div style={{ width: '100%', height: h }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke={C.grid} />
          <XAxis type="number" tick={tick} tickFormatter={compact} stroke={C.axis} />
          <YAxis type="category" dataKey="name" tick={{ ...tick, fill: 'var(--text-2)' }} width={110} stroke={C.axis} interval={0} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<Tip extra={(p) => `占比 ${pct(p.weight as number, 1)}`} />} />
          <Bar dataKey="value" name={label} fill={C.s1} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="share" position="right" fill="var(--text-2)" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// 資產成長：總值與累計淨投入，同一個 USD 軸
export function ValueChart({ data }: { data: { date: string; value: number; contribution?: number }[] }) {
  const hasContrib = data.some((d) => d.contribution != null);
  return (
    <>
      <div className="legend">
        <span>
          <i style={{ background: C.s1 }} />
          帳戶總值
        </span>
        {hasContrib && (
          <span>
            <i style={{ background: C.s2 }} />
            累計淨投入
          </span>
        )}
      </div>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="date" tick={tick} stroke={C.axis} minTickGap={24} />
            <YAxis
              tick={tick}
              tickFormatter={compact}
              stroke={C.axis}
              width={52}
              domain={[(min: number) => Math.floor((min * 0.9) / 1000) * 1000, (max: number) => Math.ceil((max * 1.05) / 1000) * 1000]}
            />
            <Tooltip content={<Tip />} cursor={{ stroke: C.axis }} />
            <Line type="monotone" dataKey="value" name="帳戶總值" stroke={C.s1} strokeWidth={2} dot={{ r: 4, fill: C.s1, stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 5 }} />
            {hasContrib && <Line type="stepAfter" dataKey="contribution" name="累計淨投入" stroke={C.s2} strokeWidth={2} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// 每年股利：淨額＋預扣稅疊起來 = 稅前
export function DividendYearChart({ data }: { data: { year: string; net: number; tax: number; estimated: boolean }[] }) {
  return (
    <>
      <div className="legend">
        <span>
          <i style={{ background: C.s1 }} />
          稅後淨額
        </span>
        <span>
          <i style={{ background: C.s2 }} />
          預扣稅
        </span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="30%" maxBarSize={56}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="year" tick={tick} stroke={C.axis} />
            <YAxis tick={tick} tickFormatter={compact} stroke={C.axis} width={52} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={<Tip extra={(p) => `稅前 ${money((p.net as number) + (p.tax as number))}${p.estimated ? '（含估算預扣稅）' : ''}`} />}
            />
            <Bar dataKey="net" name="稅後淨額" stackId="d" fill={C.s1} stroke="var(--surface)" strokeWidth={2} />
            <Bar dataKey="tax" name="預扣稅" stackId="d" fill={C.s2} stroke="var(--surface)" strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
