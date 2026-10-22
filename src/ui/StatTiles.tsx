import type { ReactNode } from 'react';
import type { Report } from '../engine/report';
import type { Analytics } from '../perf/useAnalytics';
import { money, pct, tone } from './format';

// 總覽右側的四個數字：一格一個主數字，加一個小的輔助圖（走勢、比較、量表）。
// 主數字用比例數字（不用等寬），文字一律用文字色，顏色只放在標記上。

function Tile(props: { label: ReactNode; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{props.label}</div>
      <div className="tile-value">{props.value}</div>
      {props.children}
    </div>
  );
}

// 近三個月的走勢：淡色線，最後一點用強調色
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 28;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => (hi > lo ? h - 3 - ((v - lo) / (hi - lo)) * (h - 6) : h / 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="近三個月走勢">
      <path d={d} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="3" fill="var(--series-1)" stroke="var(--page)" strokeWidth="1.5" />
    </svg>
  );
}

// Beta 量表：0 到 2，標出大盤（1.0）的位置
function BetaMeter({ beta }: { beta: number }) {
  const at = (v: number) => `${(Math.max(0, Math.min(2, v)) / 2) * 100}%`;
  return (
    <div className="meter" role="img" aria-label={`Beta ${beta.toFixed(2)}，大盤為 1`}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: at(beta) }} />
        <div className="meter-mark" style={{ left: at(1) }} />
      </div>
      <div className="meter-scale">
        <span>0</span>
        <span style={{ left: at(1) }}>大盤 1</span>
        <span>2</span>
      </div>
    </div>
  );
}

const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} 個百分點`;

export function StatTiles({ r, a }: { r: Report; a?: Analytics }) {
  const t = r.totals;
  const tr = r.totalReturn;
  const fullYear = !!tr.since && (Date.parse(r.asOf) - Date.parse(tr.since)) / 864e5 >= 365;
  const spark = a?.perf?.chart.slice(-66).map((p) => p.value) ?? [];
  const beta = a?.beta?.portfolio;
  const bench = a?.perf?.bench;
  const cash = t.schwabCash + t.twCash;
  const div = r.forecast;

  return (
    <div className="tiles">
      <Tile label="目前總值" value={money(t.totalValue, { whole: true })}>
        {t.dayChange != null && (
          <div className="tile-delta">
            今日 <span className={tone(t.dayChange)}>{money(t.dayChange, { sign: true })}</span>
            {t.dayBase ? <span className={tone(t.dayChange)}>（{pct(t.dayChange / t.dayBase, 2, true)}）</span> : null}
          </div>
        )}
        <Sparkline values={spark} />
        <div className="tile-foot">
          持股 {money(t.marketValue, { whole: true })}・現金 {money(cash, { whole: true })}
        </div>
      </Tile>

      <Tile label={tr.since ? `年化報酬率・${tr.since} 起` : '年化報酬率'} value={tr.since ? (fullYear ? pct(tr.xirr, 1) : '—') : '未設定'}>
        {tr.since && fullYear && tr.xirr != null && bench ? (
          <div className="compare">
            {[
              { k: 'S&P 500', v: bench.spx, c: 'var(--series-2)' },
              { k: 'NASDAQ', v: bench.ndx, c: 'var(--series-3)' },
            ].map((x) =>
              x.v != null ? (
                <div key={x.k} className="compare-row">
                  <i style={{ background: x.c }} />
                  <span>{x.k}</span>
                  <span className="num">{pct(x.v, 1)}</span>
                  <span className="compare-delta">
                    你 <span className={tone(tr.xirr! - x.v)}>{pp(tr.xirr! - x.v)}</span>
                  </span>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
        <div className="tile-foot">
          {tr.since && tr.netContribution != null
            ? `投入 ${money(tr.netContribution, { whole: true })}，賺 ${money(tr.gainByContribution, { sign: true, whole: true })}${fullYear ? '；指數為同樣金流、含股息' : '；未滿一年不年化'}`
            : '到「匯入與設定」設定報酬起算點（可一鍵套用建議值）'}
        </div>
      </Tile>

      <Tile label="Beta・相對 S&P 500" value={beta != null ? beta.toFixed(2) : '—'}>
        {beta != null && <BetaMeter beta={beta} />}
        <div className="tile-foot">
          {beta != null
            ? `${beta < 0.8 ? '比大盤穩定' : beta <= 1.2 ? '和大盤相近' : '波動比大盤大'}：大盤漲跌 10%，組合約 ±${(beta * 10).toFixed(1)}%`
            : a?.busy
              ? '正在取得歷史價格…'
              : '歷史價格不足'}
        </div>
      </Tile>

      <Tile label="預估年股息・稅後" value={money(div.net, { whole: true })}>
        <div className="tile-delta">
          每月約 {money(div.net / 12, { whole: true })}
          {t.marketValue > 0 && `・殖利率 ${pct(div.net / t.marketValue, 2)}`}
        </div>
        <div className="tile-foot">
          {div.label}；稅前 {money(div.gross, { whole: true })}、預扣 {money(div.tax, { whole: true })}
        </div>
      </Tile>
    </div>
  );
}
