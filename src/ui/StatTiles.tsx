import type { ReactNode } from 'react';
import type { Report } from '../engine/report';
import type { Analytics } from '../perf/useAnalytics';
import { money, pct, tone } from './format';

// 總覽右側的四個數字：一格一個主數字，加一個小的輔助圖（走勢、比較、量表）。
// 主數字用比例數字（不用等寬），文字一律用文字色，顏色只放在標記上。

function Tile(props: { label: ReactNode; value: ReactNode; delta?: ReactNode; foot?: ReactNode; title?: string; children?: ReactNode }) {
  return (
    <div className="tile" title={props.title}>
      <div className="tile-label">{props.label}</div>
      <div className="tile-value">{props.value}</div>
      <div className="tile-delta">{props.delta ?? '\u00a0'}</div>
      {props.foot && <div className="tile-foot">{props.foot}</div>}
      {props.children}
    </div>
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

// 四格同一個結構：一行標題、主數字、一行彩色變化、一行灰色補充，同一列的主數字對齊
export function StatTiles({ r, a }: { r: Report; a?: Analytics }) {
  const t = r.totals;
  const tr = r.totalReturn;
  const fullYear = !!tr.since && (Date.parse(r.asOf) - Date.parse(tr.since)) / 864e5 >= 365;
  const beta = a?.beta?.portfolio;
  const cash = t.schwabCash + t.twCash;
  const div = r.forecast;

  return (
    <div className="tiles">
      <Tile
        label="目前總值"
        value={money(t.totalValue, { whole: true })}
        delta={
          t.dayChange != null && (
            <>
              今日 <span className={tone(t.dayChange)}>{money(t.dayChange, { sign: true })}</span>
              {t.dayBase ? <span className={tone(t.dayChange)}>（{pct(t.dayChange / t.dayBase, 2, true)}）</span> : null}
            </>
          )
        }
        foot={`持股 ${money(t.marketValue, { whole: true })}・現金 ${money(cash, { whole: true })}`}
      />

      <Tile
        label="年化報酬率"
        value={tr.since ? (fullYear ? pct(tr.xirr, 1) : '—') : '未設定'}
        delta={
          tr.since && tr.gainByContribution != null && (
            <>
              期間賺 <span className={tone(tr.gainByContribution)}>{money(tr.gainByContribution, { sign: true, whole: true })}</span>
            </>
          )
        }
        foot={tr.since ? `${tr.since} 起・投入 ${money(tr.netContribution, { whole: true })}${fullYear ? '' : '・未滿一年不年化'}` : '到「匯入與設定」設定報酬起算點'}
        title="資金加權年化報酬率（XIRR）：考慮每筆投入的時間點，已扣股利預扣稅"
      />

      <Tile
        label="Beta"
        value={beta != null ? beta.toFixed(2) : '—'}
        delta={beta != null ? (beta < 0.8 ? '比大盤穩定' : beta <= 1.2 ? '和大盤相近' : '波動比大盤大') : a?.busy ? '計算中…' : undefined}
        foot={beta != null ? `相對 S&P 500：大盤漲跌 10%，組合約 ±${(beta * 10).toFixed(1)}%` : '歷史價格不足'}
        title="近 5 年月報酬；有美股 ADR 的台股用 ADR（2330 用 TSM）；現金以 0 計"
      >
        {beta != null && <BetaMeter beta={beta} />}
      </Tile>

      <Tile
        label="預估年股息"
        value={money(div.net, { whole: true })}
        delta={`每月約 ${money(div.net / 12, { whole: true })}`}
        foot={`稅後・殖利率 ${t.marketValue > 0 ? pct(div.net / t.marketValue, 2) : '—'}；稅前 ${money(div.gross, { whole: true })}、預扣 ${money(div.tax, { whole: true })}`}
        title={`未來 12 個月（${div.label}）`}
      />
    </div>
  );
}
