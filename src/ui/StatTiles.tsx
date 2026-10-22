import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Report } from '../engine/report';
import type { Analytics } from '../perf/useAnalytics';
import { money, pct, tone } from './format';

// 總覽右側的四個數字：一格一個主數字，加一個小的輔助圖（走勢、比較、量表）。
// 主數字用比例數字（不用等寬），文字一律用文字色，顏色只放在標記上。

// 一格：點整格跳到詳細內容；標題旁的 ⓘ 展開計算方式（手機沒有滑過提示，所以用點的）
function Tile(props: { label: ReactNode; value: ReactNode; delta?: ReactNode; foot?: ReactNode; info: string; open?: () => void; openLabel?: string; children?: ReactNode }) {
  const [showInfo, setShowInfo] = useState(false);
  const onKey = (e: KeyboardEvent) => {
    if (props.open && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      props.open();
    }
  };
  return (
    <div
      className={`tile ${props.open ? 'link' : ''}`}
      role={props.open ? 'button' : undefined}
      tabIndex={props.open ? 0 : undefined}
      aria-label={props.open ? props.openLabel : undefined}
      onClick={props.open}
      onKeyDown={onKey}
    >
      <div className="tile-label">
        <span>{props.label}</span>
        <button
          className="info-btn"
          aria-label="計算方式"
          aria-expanded={showInfo}
          onClick={(e) => {
            e.stopPropagation();
            setShowInfo((x) => !x);
          }}
        >
          ⓘ
        </button>
        {props.open && (
          <span className="tile-go" aria-hidden>
            ›
          </span>
        )}
      </div>
      <div className="tile-value">{props.value}</div>
      <div className="tile-delta">{props.delta ?? '\u00a0'}</div>
      {props.foot && <div className="tile-foot">{props.foot}</div>}
      {showInfo && (
        <p className="tile-info" onClick={(e) => e.stopPropagation()}>
          {props.info}
        </p>
      )}
      {props.children}
    </div>
  );
}

// 未來 12 個月每月預估股息：一個系列、同一色，月份標在下方（只標 1 月與頭尾）
function MonthBars({ data }: { data: { month: string; net: number }[] }) {
  const max = Math.max(...data.map((d) => d.net), 0);
  if (!(max > 0)) return null;
  return (
    <div className="mbars" role="img" aria-label={`每月預估股息：${data.map((d) => `${Number(d.month.slice(5))}月 ${money(d.net, { whole: true })}`).join('、')}`}>
      <div className="mbars-plot">
        {data.map((d) => (
          <div key={d.month} className="mbar" title={`${d.month}：${money(d.net)}`}>
            <span style={{ height: `${Math.max(d.net > 0 ? 6 : 0, (d.net / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mbars-axis">
        {data.map((d, i) => (
          <span key={d.month}>{i === 0 || i === data.length - 1 || d.month.endsWith('-01') ? `${Number(d.month.slice(5))}月` : ''}</span>
        ))}
      </div>
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
export type Go = (tab: 'overview' | 'holdings' | 'dividends', target?: string) => void;

export function StatTiles({ r, a, go }: { r: Report; a?: Analytics; go?: Go }) {
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
        info="兩家券商的持股市值（依最新報價）加現金，台股依目前匯率換成美元。今日漲跌＝（現價 − 前一日收盤）× 股數，當天買進的從成交價算起。點一下看資產成長。"
        open={go && (() => go('overview', 'growth'))}
        openLabel="目前總值：看資產成長"
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
        info="資金加權年化報酬率（XIRR）：起算日的帳戶總值與之後每筆入金都算進去，考慮投入的時間點；股利預扣稅已扣除。起算點在「匯入與設定」。點一下看年度表現。"
        open={go && (() => go('overview', 'yearly'))}
        openLabel="年化報酬率：看年度表現"
      />

      <Tile
        label="Beta"
        value={beta != null ? beta.toFixed(2) : '—'}
        delta={beta != null ? (beta < 0.8 ? '比大盤穩定' : beta <= 1.2 ? '和大盤相近' : '波動比大盤大') : a?.busy ? '計算中…' : undefined}
        foot={beta != null ? `相對 S&P 500：大盤漲跌 10%，組合約 ±${(beta * 10).toFixed(1)}%` : '歷史價格不足'}
        info="近 5 年的月報酬（含息）相對 S&P 500 計算；有美股 ADR 的台股用 ADR（2330 用 TSM），其他台股換成美元。組合 Beta 依市值加權，現金以 0 計。點一下看各檔的 Beta。"
        open={go && (() => go('holdings', 'col-beta'))}
        openLabel="Beta：看各檔持股的 Beta"
      >
        {beta != null && <BetaMeter beta={beta} />}
      </Tile>

      <Tile
        label="預估年股息"
        value={money(div.net, { whole: true })}
        delta={`每月約 ${money(div.net / 12, { whole: true })}`}
        foot={`稅後・殖利率 ${t.marketValue > 0 ? pct(div.net / t.marketValue, 2) : '—'}；稅前 ${money(div.gross, { whole: true })}、預扣 ${money(div.tax, { whole: true })}`}
        info={`未來 12 個月（${div.label}）：年化每股股利 × 目前股數，扣掉預扣稅（美股用實際觀察到的稅率，台股 0%）。長條是每月預估，照 Schwab 預估或過去一年的配息月份分配。點一下看股利明細。`}
        open={go && (() => go('dividends', 'forecast'))}
        openLabel="預估年股息：看股利明細"
      >
        <MonthBars data={div.monthly} />
      </Tile>
    </div>
  );
}
