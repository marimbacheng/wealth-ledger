import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis } from 'recharts';
import { ramp, type RampSpec } from './color';
import { compactMoney, money, niceAxis, pct, yearTicks } from './format';

// 折線、長條只用驗證過的兩個分類色（series-1 石油藍、series-2 赭黃），其餘是文字與細線色。
const C = {
  s1: 'var(--series-1)',
  s2: 'var(--series-2)',
  tax: 'var(--tax)', // 預扣稅：淺灰，代表「被扣走的部分」
  grid: 'var(--rule)',
  axis: 'var(--rule)',
  muted: 'var(--muted)',
};
const tick = { fill: C.muted, fontSize: 11 };
const compact = (n: number) => compactMoney(n);

// 目前是否為深色：使用者在頁首指定的外觀優先，沒指定就跟隨系統
function isDarkNow(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function useDark(): boolean {
  const [dark, setDark] = useState(isDarkNow);
  useEffect(() => {
    const update = () => setDark(isDarkNow());
    const q = window.matchMedia?.('(prefers-color-scheme: dark)');
    q?.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      q?.removeEventListener('change', update);
      mo.disconnect();
    };
  }, []);
  return dark;
}

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
      <div className="t">{(row.date as string | undefined) ?? label}</div>
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

// 漸層環圈圖：依占比排序，一檔（或一個產業）一個色號。
// 相鄰色號差異小，所以每塊之間留 2px 間隙，旁邊的清單附占比，滑過時清單與色塊互相標示。
export function GradientDonut(props: {
  data: { name: string; value: number; weight: number; sub?: string }[];
  spec: RampSpec;
  centerLabel: string;
  centerValue: string;
}) {
  const dark = useDark();
  const data = useMemo(() => [...props.data].sort((a, b) => b.value - a.value), [props.data]);
  const colors = useMemo(() => ramp(data.length, props.spec, dark ? 'dark' : 'light'), [data.length, props.spec, dark]);
  const [active, setActive] = useState<number | undefined>(undefined);
  const hovered = active != null ? data[active] : undefined;

  return (
    <div className="donut">
      <div className="ring">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="96%"
              startAngle={90}
              endAngle={-270}
              stroke="var(--page)"
              strokeWidth={2}
              activeIndex={active}
              activeShape={(p: unknown) => {
                const s = p as { outerRadius: number } & Record<string, unknown>;
                return <Sector {...(s as object)} outerRadius={s.outerRadius + 6} />;
              }}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(undefined)}
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={colors[i]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="center">
          {hovered ? (
            <>
              <div className="small">{hovered.name}</div>
              <div className="big">{pct(hovered.weight, 1)}</div>
              <div className="small">{money(hovered.value, { whole: true })}</div>
            </>
          ) : (
            <>
              <div className="small">{props.centerLabel}</div>
              <div className="big">{props.centerValue}</div>
            </>
          )}
        </div>
      </div>
      <ul className={`donut-legend ${data.length <= 8 ? 'one' : ''}`}>
        {data.map((d, i) => (
          <li key={d.name} className={active === i ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(undefined)}>
            <i style={{ background: colors[i] }} />
            <span className="n" title={d.sub ?? d.name}>
              {d.name}
            </span>
            <span className="p">{pct(d.weight, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 資產成長：總值與累計投入，同一個 USD 軸
export function ValueChart({ data }: { data: { date: string; value: number; contribution?: number }[] }) {
  const hasContrib = data.some((d) => d.contribution != null);
  // 依實際日期等比例排列（資料點間隔不均也不會失真），刻度標年份
  const points = data.map((d) => ({ ...d, t: Date.parse(`${d.date}T00:00:00Z`) }));
  const min = points[0]?.t ?? 0;
  const max = points[points.length - 1]?.t ?? 0;
  const values = points.flatMap((p) => [p.value, ...(p.contribution != null ? [p.contribution] : [])]);
  const y = niceAxis(Math.min(...values), Math.max(...values));
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
            累計投入
          </span>
        )}
      </div>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[min, max]}
              ticks={yearTicks(min, max)}
              tickFormatter={(t: number) => String(new Date(t).getUTCFullYear())}
              tick={tick}
              stroke={C.axis}
            />
            <YAxis tick={tick} tickFormatter={compact} stroke={C.axis} width={52} domain={y.domain} ticks={y.ticks} />
            <Tooltip content={<Tip />} cursor={{ stroke: C.muted }} />
            <Line type="monotone" dataKey="value" name="帳戶總值" stroke={C.s1} strokeWidth={2} dot={points.length > 60 ? false : { r: 4, fill: C.s1, stroke: 'var(--page)', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={points.length <= 60} />
            {hasContrib && <Line type="stepAfter" dataKey="contribution" name="累計投入" stroke={C.s2} strokeWidth={2} dot={false} />}
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
          <i style={{ background: C.tax }} />
          預扣稅
        </span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="30%" maxBarSize={40}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="year" tick={tick} stroke={C.axis} />
            <YAxis tick={tick} tickFormatter={compact} stroke={C.axis} width={52} />
            <Tooltip
              cursor={{ fill: 'var(--soft)' }}
              content={<Tip extra={(p) => `稅前 ${money((p.net as number) + (p.tax as number))}${p.estimated ? '（含估算預扣稅）' : ''}`} />}
            />
            <Bar dataKey="net" name="稅後淨額" stackId="d" fill={C.s1} stroke="var(--page)" strokeWidth={2} />
            <Bar dataKey="tax" name="預扣稅" stackId="d" fill={C.tax} stroke="var(--page)" strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
