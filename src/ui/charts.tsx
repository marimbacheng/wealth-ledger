import { useEffect, useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis } from 'recharts';
import { benchValues } from '../engine/performance';
import { ramp, type RampSpec } from './color';
import { compactMoney, monthTicks, money, niceAxis, pct, yearTicks } from './format';

// 分類色只用驗證過的三色（series-1 石油藍＝我的組合、series-2 赭黃＝S&P 500、series-3 莓紅＝NASDAQ），其餘是文字與細線色。
const C = {
  s1: 'var(--series-1)',
  s2: 'var(--series-2)',
  s3: 'var(--series-3)', // 第三色（NASDAQ），和前兩色一起驗證過
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

// ---------- 資產成長（每日重建值） ----------

type Range = 'all' | '3y' | '1y' | 'ytd';
const RANGES: { id: Range; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: '3y', label: '近 3 年' },
  { id: '1y', label: '近 1 年' },
  { id: 'ytd', label: '今年' },
];

function rangeStart(r: Range, last: string): string {
  const y = Number(last.slice(0, 4));
  if (r === 'ytd') return `${y - 1}-12-31`;
  if (r === '1y') return `${y - 1}${last.slice(4)}`;
  if (r === '3y') return `${y - 3}${last.slice(4)}`;
  return '0000-00-00';
}

// 點太多時抽樣（保留第一、最後與投入有變動的日子），圖形一樣、手機上比較順
function sample<T extends { contribution?: number }>(xs: T[], max = 320): T[] {
  if (xs.length <= max) return xs;
  const step = Math.ceil(xs.length / max);
  return xs.filter((x, i) => i % step === 0 || i === xs.length - 1 || x.contribution !== xs[i - 1]?.contribution);
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

type GrowthRow = { date: string; value: number; contribution?: number; flow?: number; spx?: number; ndx?: number };
type Cmp = 'contribution' | 'spx' | 'ndx';
const CMP: { id: Cmp; label: string; color: string; dash?: string }[] = [
  { id: 'contribution', label: '累計投入', color: C.muted, dash: '4 3' },
  { id: 'spx', label: 'S&P 500（含息）', color: C.s2 },
  { id: 'ndx', label: 'NASDAQ（含息）', color: C.s3 },
];

function GrowthTip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const row = (payload[0].payload ?? {}) as GrowthRow & { cSpx?: number; cNdx?: number; contribution?: number; show?: Cmp[] };
  const show = row.show ?? [];
  const diff = (v?: number) => (v != null ? `（你 ${money(row.value - v, { sign: true, whole: true })}）` : '');
  return (
    <div className="chart-tip">
      <div className="t">{row.date}</div>
      <div>帳戶總值：{money(row.value)}</div>
      {show.includes('contribution') && row.contribution != null && (
        <div>
          累計投入：{money(row.contribution)}，投資損益 {money(row.value - row.contribution, { sign: true })}
        </div>
      )}
      {show.includes('spx') && row.cSpx != null && (
        <div>
          改買 S&amp;P 500：{money(row.cSpx)}
          {diff(row.cSpx)}
        </div>
      )}
      {show.includes('ndx') && row.cNdx != null && (
        <div>
          改買 NASDAQ：{money(row.cNdx)}
          {diff(row.cNdx)}
        </div>
      )}
    </div>
  );
}

export function GrowthChart({ data }: { data: GrowthRow[] }) {
  const [range, setRange] = useState<Range>('all');
  const [show, setShow] = useState<Cmp[]>(['contribution', 'spx']);
  const toggle = (c: Cmp) => setShow((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const last = data[data.length - 1]?.date ?? '';
  const from = rangeStart(range, last);
  const shown = useMemo(() => {
    const rows = data.filter((d) => d.date >= from);
    // 區間內重新起算：第一天的投入＝當天總值
    const c0 = rows[0]?.contribution ?? 0;
    const v0 = rows[0]?.value ?? 0;
    const spx = benchValues(rows, 'spx');
    const ndx = benchValues(rows, 'ndx');
    const full = rows.map((r, i) => ({ ...r, contribution: r.contribution != null ? r.contribution - c0 + v0 : undefined, cSpx: spx[i], cNdx: ndx[i], show, t: Date.parse(`${r.date}T00:00:00Z`) }));
    return sample(full);
  }, [data, from, show]);
  const first = shown[0];
  const end = shown[shown.length - 1];
  if (!first || !end) return null;
  const min = first.t;
  const max = end.t;
  const values = shown.flatMap((d) => [d.value, show.includes('contribution') ? d.contribution : undefined, show.includes('spx') ? d.cSpx : undefined, show.includes('ndx') ? d.cNdx : undefined].filter((v): v is number => v != null));
  const y = niceAxis(Math.min(...values), Math.max(...values));
  const invested = (end.contribution ?? 0) - (first.contribution ?? 0);
  const gain = end.value - first.value - invested;
  const long = max - min > 400 * 864e5;
  const ticks = long ? yearTicks(min, max) : monthTicks(min, max);
  const fmtTick = (t: number) => (long ? String(new Date(t).getUTCFullYear()) : `${new Date(t).getUTCMonth() + 1}月`);
  const vs = (v?: number) => (v != null ? end.value - v : undefined);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div className="seg" role="tablist" aria-label="期間">
          {RANGES.map((r) => (
            <button key={r.id} role="tab" aria-selected={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="比較">
          {CMP.map((c) => (
            <button key={c.id} className={`chip ${show.includes(c.id) ? 'on' : ''}`} aria-pressed={show.includes(c.id)} onClick={() => toggle(c.id)}>
              <i style={{ background: c.color }} />
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="growth-stats">
        <span>
          {first.date} {money(first.value, { whole: true })} → {money(end.value, { whole: true })}
        </span>
        <span>期間投入 {money(invested, { sign: true, whole: true })}</span>
        <span className={gain >= 0 ? 'up' : 'down'}>投資損益 {money(gain, { sign: true, whole: true })}</span>
        {show.includes('spx') && vs(end.cSpx) != null && (
          <span>
            比改買 S&amp;P 500 <b className={vs(end.cSpx)! >= 0 ? 'up' : 'down'}>{money(vs(end.cSpx), { sign: true, whole: true })}</b>
          </span>
        )}
        {show.includes('ndx') && vs(end.cNdx) != null && (
          <span>
            比改買 NASDAQ <b className={vs(end.cNdx)! >= 0 ? 'up' : 'down'}>{money(vs(end.cNdx), { sign: true, whole: true })}</b>
          </span>
        )}
      </div>
      <div style={{ width: '100%', height: 260, marginTop: 6 }}>
        <ResponsiveContainer>
          <ComposedChart data={shown} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.s1} stopOpacity={0.22} />
                <stop offset="100%" stopColor={C.s1} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="t" type="number" scale="time" domain={[min, max]} ticks={ticks} tickFormatter={fmtTick} tick={tick} stroke={C.axis} />
            <YAxis tick={tick} tickFormatter={compact} stroke={C.axis} width={52} domain={y.domain} ticks={y.ticks} />
            <Tooltip content={<GrowthTip />} cursor={{ stroke: C.muted }} />
            <Area type="monotone" dataKey="value" name="帳戶總值" stroke={C.s1} strokeWidth={2} fill="url(#growthFill)" isAnimationActive={false} />
            {show.includes('contribution') && <Line type="stepAfter" dataKey="contribution" name="累計投入" stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
            {show.includes('spx') && <Line type="monotone" dataKey="cSpx" name="S&P 500" stroke={C.s2} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            {show.includes('ndx') && <Line type="monotone" dataKey="cNdx" name="NASDAQ" stroke={C.s3} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="desc" style={{ marginTop: 6 }}>
        <i className="legend-dot" style={{ background: C.s1 }} />
        帳戶總值。比較線：同一段期間、同樣的入金時間與金額，若改買 S&amp;P 500 或 NASDAQ 的總報酬指數（含股息再投入）會是多少。
      </p>
    </>
  );
}

// ---------- 年度累積報酬（我的組合 vs 指數） ----------

export function YearReturnChart({ data }: { data: { date: string; p?: number; spx?: number; ndx?: number }[] }) {
  const pts = data.map((d) => ({ ...d, t: Date.parse(`${d.date}T00:00:00Z`) }));
  if (pts.length < 2) return null;
  const min = pts[0].t;
  const max = pts[pts.length - 1].t;
  const vals = pts.flatMap((d) => [d.p, d.spx, d.ndx].filter((v): v is number => v != null));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5].find((s) => (hi - lo) / s <= 6) ?? 1;
  const yTicks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) yTicks.push(Math.round(v * 1e6) / 1e6);
  return (
    <>
      <div className="legend">
        <span>
          <i style={{ background: C.s1 }} />
          我的組合
        </span>
        <span>
          <i style={{ background: C.s2 }} />
          S&amp;P 500（含息）
        </span>
        <span>
          <i style={{ background: C.s3 }} />
          NASDAQ（含息）
        </span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={pts} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="t" type="number" scale="time" domain={[min, max]} ticks={monthTicks(min, max)} tickFormatter={(t: number) => `${new Date(t).getUTCMonth() + 1}月`} tick={tick} stroke={C.axis} />
            <YAxis tick={tick} tickFormatter={(v: number) => pct(v, 0)} stroke={C.axis} width={44} domain={[yTicks[0], yTicks[yTicks.length - 1]]} ticks={yTicks} />
            <ReferenceLine y={0} stroke={C.axis} />
            <Tooltip
              cursor={{ stroke: C.muted }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="chart-tip">
                    <div className="t">{ymd((payload[0].payload as { t: number }).t)}</div>
                    {payload.map((x) => (
                      <div key={String(x.name)}>
                        {x.name}：{pct(x.value as number, 2, true)}
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
            <Line type="monotone" dataKey="p" name="我的組合" stroke={C.s1} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="spx" name="S&P 500" stroke={C.s2} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="ndx" name="NASDAQ" stroke={C.s3} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
