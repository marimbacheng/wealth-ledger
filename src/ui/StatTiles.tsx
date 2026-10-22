import { useState, type ReactNode } from 'react';
import type { Report } from '../engine/report';
import type { Analytics } from '../perf/useAnalytics';
import { brokerCostName, schwabHolds } from './costTerms';
import { displayRate, money, pct, tone } from './format';

// 總覽右側的四個數字：一格一個主數字，加一個小的輔助圖（走勢、比較、量表）。
// 主數字用比例數字（不用等寬），文字一律用文字色，顏色只放在標記上。

// 一格：標題旁的 ⓘ 展開計算方式（手機沒有滑過提示，所以用點的）
function Tile(props: { label: ReactNode; value: ReactNode; delta?: ReactNode; foot?: ReactNode; info: string; children?: ReactNode }) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="tile">
      <div className="tile-label">
        <span>{props.label}</span>
        <button className="info-btn" aria-label="計算方式" aria-expanded={showInfo} onClick={() => setShowInfo((x) => !x)}>
          ⓘ
        </button>
      </div>
      <div className="tile-value">{typeof props.value === 'string' ? <Figure text={props.value} /> : props.value}</div>
      <div className="tile-delta">{props.delta ?? '\u00a0'}</div>
      {props.foot && <div className="tile-foot">{props.foot}</div>}
      {showInfo && <p className="tile-info">{props.info}</p>}
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

// Beta 指針：中性的灰色軌道、標出大盤 1 的刻度，指針標出組合的位置。
// 不用填滿的長條：長條越滿看起來越好，但 Beta 越大只代表波動越大
function BetaMeter({ beta }: { beta: number }) {
  const at = (v: number) => `${(Math.max(0, Math.min(2, v)) / 2) * 100}%`;
  return (
    <div className="meter" role="img" aria-label={`Beta ${beta.toFixed(2)}，大盤為 1`}>
      <div className="meter-track">
        <div className="meter-mark" style={{ left: at(1) }} />
        <div className="meter-pointer" style={{ left: at(beta) }} />
      </div>
      <div className="meter-scale">
        <span>穩定</span>
        <span style={{ left: at(1) }}>大盤 1</span>
        <span>波動大</span>
      </div>
    </div>
  );
}

// 主數字的貨幣符號與單位用小一號、淡一點的字，數字本身更突出（$49,256、NT$1,600,123、16.1%）
function Figure({ text }: { text: string }) {
  const m = text.match(/^([+\-−]?)([^\d]*?)(\d[\d.,]*)(\D*)$/);
  if (!m) return <>{text}</>;
  const [, sign, pre, num, suf] = m;
  return (
    <>
      {sign}
      {pre && <span className="unit">{pre}</span>}
      {num}
      {suf && <span className="unit">{suf}</span>}
    </>
  );
}

// 總覽最上面的大數字：目前總值與今日漲跌。盤中每分鐘跟著報價更新，是打開時最先要看的數字
export function TotalValueHero({ r }: { r: Report }) {
  const t = r.totals;
  const cash = t.schwabCash + t.twCash;
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="kpi ov-hero">
      <div className="label tile-label">
        <span>目前總值・持股＋現金</span>
        <button className="info-btn" aria-label="計算方式" aria-expanded={showInfo} onClick={() => setShowInfo((x) => !x)}>
          ⓘ
        </button>
      </div>
      <div className="value hero">
        <Figure text={money(t.totalValue, { whole: true })} />
      </div>
      {t.dayChange != null && (
        <div className="hero-delta">
          今日 <span className={tone(t.dayChange)}>{money(t.dayChange, { sign: true })}</span>
          {t.dayBase ? <span className={tone(t.dayChange)}>（{pct(t.dayChange / t.dayBase, 2, true)}）</span> : null}
        </div>
      )}
      <div className="foot">
        持股 {money(t.marketValue, { whole: true })}・現金 {money(cash, { whole: true })}
      </div>
      {showInfo && (
        <p className="tile-info">兩家券商的持股市值（依最新報價）加現金，台股依目前匯率換成美元。今日漲跌＝（現價 − 前一日收盤）× 股數，當天買進的從成交價算起。</p>
      )}
    </div>
  );
}

// 四格同一個結構：一行標題、主數字、一行彩色變化、一行灰色補充，同一列的主數字對齊
export function StatTiles({ r, a }: { r: Report; a?: Analytics }) {
  const tr = r.totalReturn;
  const fullYear = !!tr.since && (Date.parse(r.asOf) - Date.parse(tr.since)) / 864e5 >= 365;
  const beta = a?.beta?.portfolio;
  const div = r.forecast;
  const B = brokerCostName(schwabHolds(r.holdings));
  // 兩段各自四捨五入會和總數差 1，所以「已實現・股利等」用顯示幣別取整後的總數減未實現
  const rate = displayRate();
  const rest = (Math.round(tr.total * rate) - Math.round(tr.unrealized * rate)) / rate;

  return (
    <div className="tiles">
      <Tile
        label="累積報酬"
        value={money(tr.total, { sign: true, whole: true })}
        delta={
          <>
            未實現 <span className={tone(tr.unrealized)}>{money(tr.unrealized, { sign: true, whole: true })}</span>
          </>
        }
        foot={`已實現・股利等 ${money(rest, { sign: true, whole: true })}`}
        info="跨券商、只算已匯入的資料：未實現（延續成本，從第一次買進算起）＋已實現＋遷移中＋稅後股利＋利息 − 帳外費用。各項金額列在「累積報酬明細」。"
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
        info="資金加權年化報酬率（XIRR）：起算日的帳戶總值與之後每筆入金都算進去，考慮投入的時間點；股利預扣稅已扣除。起算點在「匯入與設定」。"
      />

      <Tile
        label="Beta"
        value={beta != null ? beta.toFixed(2) : '—'}
        delta={beta != null ? (beta < 0.8 ? '比大盤穩定' : beta <= 1.2 ? '和大盤相近' : '波動比大盤大') : a?.busy ? '計算中…' : undefined}
        foot={beta != null ? `相對 S&P 500：大盤漲跌 10%，組合約 ±${(beta * 10).toFixed(1)}%` : '歷史價格不足'}
        info="近 5 年的月報酬（含息）相對 S&P 500 計算；有美股 ADR 的台股用 ADR（2330 用 TSM），其他台股換成美元。組合 Beta 依市值加權，現金以 0 計。"
      >
        {beta != null && <BetaMeter beta={beta} />}
      </Tile>

      <Tile
        label="預估年股息"
        value={money(div.net, { whole: true })}
        delta={`每月約 ${money(div.net / 12, { whole: true })}`}
        foot={`成本殖利率（稅後）：${B.replace('成本', '')} ${pct(r.yoc.brokerNet, 2)}・延續 ${pct(r.yoc.contNet, 2)}`}
        info={`未來 12 個月（${div.label}）：年化每股股利 × 目前股數，扣掉預扣稅（美股用實際觀察到的稅率，台股 0%）：稅前 ${money(div.gross, { whole: true })}、預扣 ${money(div.tax, { whole: true })}。成本殖利率＝稅後預估股息 ÷ 成本，分別用${B}與延續成本計算。長條是每月預估，照 Schwab 預估或過去一年的配息月份分配。`}
      >
        <MonthBars data={div.monthly} />
      </Tile>
    </div>
  );
}
