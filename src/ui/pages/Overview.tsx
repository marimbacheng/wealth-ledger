import type { PageProps } from '../../App';
import { DividendYearChart, ValueChart, WeightBars } from '../charts';
import { Card, Gain, Kpi, Notice, TotalsBadge } from '../components';
import { money, pct, tone } from '../format';

export function Overview({ report: r, store }: PageProps) {
  const t = r.totals;
  const tr = r.totalReturn;
  const hasTw = t.twCost > 0 || r.dividends.twYtd.count > 0;
  const hasSchwab = t.schwabValue > 0;
  const lastYear = r.dividends.byYear[r.dividends.byYear.length - 1];
  const priceDates = [...new Set(r.holdings.map((h) => h.priceDate).filter(Boolean))].sort();

  return (
    <>
      <Notice title="需要注意" items={r.warnings} />

      <div className="grid">
        <Card>
          <Kpi
            hero
            label="跨券商累積報酬（已知部分）"
            value={<Gain value={tr.total} />}
            foot="延續帳未實現 + 已實現 + 股利淨額 + 利息 − 帳外費用"
          />
          <div className="kv" style={{ marginTop: 8 }}>
            <span>未實現（歷史成本）</span>
            <span className={tone(tr.unrealized)}>{money(tr.unrealized, { sign: true })}</span>
            <span>已實現</span>
            <span className={tone(tr.realized)}>{money(tr.realized, { sign: true })}</span>
            {Math.abs(tr.pendingMigration) > 0.005 && (
              <>
                <span>遷移中（已賣出待買回）</span>
                <span className={tone(tr.pendingMigration)}>{money(tr.pendingMigration, { sign: true })}</span>
              </>
            )}
            <span>累積股利（稅後）</span>
            <span>{money(tr.dividendsNet)}</span>
            {tr.interest !== 0 && (
              <>
                <span>利息</span>
                <span>{money(tr.interest)}</span>
              </>
            )}
            {tr.fees !== 0 && (
              <>
                <span>帳外費用</span>
                <span>{money(-tr.fees)}</span>
              </>
            )}
          </div>
        </Card>

        <Card>
          <Kpi
            label="目前總值"
            value={money(t.totalValue)}
            foot={`持股市值 ${money(t.marketValue)} · 現金 ${money(t.schwabCash + t.twCash)}${priceDates.length ? ` · 價格日 ${priceDates[priceDates.length - 1]}` : ''}`}
          />
          {tr.netContribution != null ? (
            <div className="kv" style={{ marginTop: 8 }}>
              <span>累計淨投入</span>
              <span>{money(tr.netContribution)}</span>
              <span>現值 − 淨投入</span>
              <span className={tone(tr.gainByContribution)}>{money(tr.gainByContribution, { sign: true })}</span>
              <span>年化報酬（XIRR）</span>
              <span>{pct(tr.xirr)}</span>
              <span>未歸因差額</span>
              <span className="muted">{money(tr.residual, { sign: true })}</span>
            </div>
          ) : (
            <p className="desc" style={{ marginTop: 8 }}>
              在「匯入與設定」填入期初累計淨投入後，這裡會顯示「現值 − 淨投入」與年化報酬率（XIRR）。
            </p>
          )}
        </Card>

        <Card>
          <Kpi
            label={`預估未來 12 個月股息（${r.forecast.label}）`}
            value={money(r.forecast.net)}
            foot={`稅後 · 稅前 ${money(r.forecast.gross)}，預扣 ${money(r.forecast.tax)}`}
          />
          <div className="kv" style={{ marginTop: 8 }}>
            <span>成本殖利率・歷史成本（稅後）</span>
            <span>{pct(r.yoc.contNet)}</span>
            <span>成本殖利率・券商成本（稅後）</span>
            <span>{pct(r.yoc.brokerNet)}</span>
            <span>近 12 個月實領 ÷ 歷史成本</span>
            <span>{pct(r.yoc.ttmContNet)}</span>
          </div>
        </Card>
      </div>

      <div className="grid">
        <Card title="延續帳（歷史成本）" desc="把六年來的原始成本延續到複委託；看投資歷程與成本殖利率用">
          <div className="kv">
            <span>持倉歷史成本</span>
            <span>{money(t.contCost)}</span>
            <span>市值</span>
            <span>{money(t.marketValue)}</span>
            <span className="total">帳面盈虧</span>
            <span className="total">
              <Gain value={t.contGain} base={t.contCost} />
            </span>
          </div>
        </Card>
        <Card title="券商帳（實際成本）" desc="各券商帳上的成本；與券商 App 對帳、計算海外所得用">
          <div className="kv">
            {hasSchwab && (
              <>
                <span>Schwab 成本</span>
                <span>{money(t.brokerCost - t.twCost)}</span>
                <span>Schwab 帳面盈虧</span>
                <span>
                  <Gain value={t.schwabValue - (t.brokerCost - t.twCost)} base={t.brokerCost - t.twCost} />
                </span>
              </>
            )}
            <span>複委託成本</span>
            <span>{hasTw ? money(t.twCost) : '尚未買進'}</span>
            <span className="total">複委託帳面盈虧</span>
            <span className="total">{hasTw ? <Gain value={t.twGain} base={t.twCost} /> : '—'}</span>
          </div>
        </Card>
        <Card title="股利" desc="合併 Schwab 與複委託">
          <div className="kv">
            <span>累積稅前</span>
            <span>{money(r.dividends.total.gross)}</span>
            <span>累積預扣稅</span>
            <span>{money(r.dividends.total.tax)}</span>
            <span className="total">累積稅後</span>
            <span className="total">{money(r.dividends.total.net)}</span>
            <span>{r.dividends.year} 年複委託實領</span>
            <span>{money(r.dividends.twYtd.net)}</span>
            {lastYear && (
              <>
                <span>{lastYear.year} 年合計實領</span>
                <span>{money(lastYear.totals.net)}</span>
              </>
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            <TotalsBadge t={r.dividends.total} />
          </div>
        </Card>
      </div>

      <div className="grid two">
        <Card title="資產成長趨勢" desc={r.valueSeries.length < 3 ? '目前只有少數資產快照；可在「匯入與設定」補登過去對帳單的月底總值。' : undefined}>
          {r.valueSeries.length > 0 ? <ValueChart data={r.valueSeries} /> : <p className="muted">尚無資產快照</p>}
        </Card>
        <Card title="每年股利" desc="稅後淨額 + 預扣稅 = 稅前">
          <DividendYearChart
            data={r.dividends.byYear.map((y) => ({
              year: String(y.year),
              net: y.totals.net,
              tax: y.totals.tax,
              estimated: y.totals.estimatedCount > 0,
            }))}
          />
        </Card>
      </div>

      <div className="grid two">
        <Card title="持股比例" desc="依市值">
          <WeightBars data={r.holdings.map((h) => ({ name: h.symbol, value: h.marketValue, weight: h.weight }))} label="市值" />
        </Card>
        <Card title="產業分布" desc="依市值；ETF 單獨列示，可在設定頁調整分類">
          <WeightBars data={r.sectors} label="市值" />
        </Card>
      </div>

      <Card title="資料涵蓋範圍" desc="累積數字只包含已匯入的期間；較早年度請補匯入或手動補登">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="l">資料</th>
                <th>起</th>
                <th>迄</th>
              </tr>
            </thead>
            <tbody>
              {r.coverage.map((c) => (
                <tr key={c.label + c.from}>
                  <td className="l">{c.label}</td>
                  <td>{c.from}</td>
                  <td>{c.to}</td>
                </tr>
              ))}
              {store.snapshots.map((s) => (
                <tr key={s.id}>
                  <td className="l">{s.broker === 'schwab' ? 'Schwab' : '複委託'} 持倉快照</td>
                  <td colSpan={2}>{s.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
