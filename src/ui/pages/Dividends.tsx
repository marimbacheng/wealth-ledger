import { useMemo, useState } from 'react';
import type { PageProps } from '../../App';
import { DPS_SOURCE_LABEL } from '../../engine/report';
import { DividendYearChart } from '../charts';
import { Card, Kpi, TaxBadge, TotalsBadge } from '../components';
import { money, pct, qty } from '../format';

export function Dividends({ report: r, store }: PageProps) {
  const d = r.dividends;
  const [symFilter, setSymFilter] = useState('');
  const holdingsBySym = useMemo(() => new Map(r.holdings.map((h) => [h.symbol, h])), [r.holdings]);
  const symbols = Object.entries(d.bySymbol).sort((a, b) => b[1].totals.net - a[1].totals.net);
  const events = d.events.filter((e) => !symFilter || e.symbol === symFilter).slice().reverse();
  const dripRows = r.holdings.filter((h) => h.drip);
  const allDrip = Object.entries(r.ledgers.drip);

  return (
    <>
      <div className="grid">
        <Card>
          <Kpi label={`${d.year} 年複委託實領股利`} value={money(d.twYtd.net)} foot={d.twYtd.count ? `稅前 ${money(d.twYtd.gross)}，預扣 ${money(d.twYtd.tax)}，${d.twYtd.count} 筆` : '以複委託股利紀錄為準；尚無紀錄'} />
          {d.twYtd.count > 0 && <TotalsBadge t={d.twYtd} />}
        </Card>
        <Card>
          <Kpi label="投資組合累積股利（稅後）" value={money(d.total.net)} foot={`稅前 ${money(d.total.gross)} − 預扣稅 ${money(d.total.tax)}，共 ${d.total.count} 筆`} />
          <TotalsBadge t={d.total} />
        </Card>
        <Card>
          <Kpi label={`預估未來 12 個月（${r.forecast.label}）`} value={money(r.forecast.net)} foot={`稅後 · 稅前 ${money(r.forecast.gross)}`} />
          <span className="badge est">預估值，依目前股數 × 年化每股股利</span>
        </Card>
      </div>

      <div className="grid two">
        <Card title="每年股利" desc="依入帳日歸年">
          <DividendYearChart data={d.byYear.map((y) => ({ year: String(y.year), net: y.totals.net, tax: y.totals.tax, estimated: y.totals.estimatedCount > 0 }))} />
        </Card>
        <Card title="年度明細">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">年度</th>
                  <th>稅前</th>
                  <th>預扣稅</th>
                  <th>稅後實領</th>
                  <th>Schwab 稅後</th>
                  <th>複委託稅後</th>
                  <th className="l">稅務</th>
                </tr>
              </thead>
              <tbody>
                {d.byYear.map((y) => (
                  <tr key={y.year}>
                    <td className="l">{y.year}</td>
                    <td>{money(y.totals.gross)}</td>
                    <td>{money(y.totals.tax)}</td>
                    <td>{money(y.totals.net)}</td>
                    <td>{money(y.byBroker.schwab.net)}</td>
                    <td>{money(y.byBroker.tw.net)}</td>
                    <td className="l">
                      <TotalsBadge t={y.totals} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l">合計</td>
                  <td>{money(d.total.gross)}</td>
                  <td>{money(d.total.tax)}</td>
                  <td>{money(d.total.net)}</td>
                  <td />
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>

      <div className="section">
        <Card title="預估未來 12 個月股息" desc="年化每股股利（稅前）× 目前股數；預扣稅率優先用實際紀錄觀察到的稅率。可在「匯入與設定 → 個股設定」手動覆寫。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">代號</th>
                  <th>股數</th>
                  <th>年化每股股利</th>
                  <th className="l">來源</th>
                  <th>預扣稅率</th>
                  <th>稅前</th>
                  <th>稅後</th>
                  <th>殖利率（現價）</th>
                  <th>成本殖利率（歷史・稅前）</th>
                  <th>成本殖利率（歷史・稅後）</th>
                  <th>成本殖利率（券商・稅後）</th>
                </tr>
              </thead>
              <tbody>
                {r.holdings.map((h) => {
                  const f = h.forecast;
                  return (
                    <tr key={h.symbol}>
                      <td className="l">{h.symbol}</td>
                      <td>{qty(f.qty)}</td>
                      <td>{money(f.dps)}</td>
                      <td className="l">
                        <span className={`badge ${f.dpsSource === 'none' ? 'est' : ''}`}>{DPS_SOURCE_LABEL[f.dpsSource]}</span>
                      </td>
                      <td title={f.rateSource === 'observed' ? '實際紀錄觀察值' : f.rateSource === 'override' ? '手動設定' : '預設值'}>
                        {pct(f.rate, 0)}
                        {f.rateSource === 'default' && <span className="muted">*</span>}
                      </td>
                      <td>{money(f.gross)}</td>
                      <td>{money(f.net)}</td>
                      <td>{pct(h.price ? f.dps / h.price : undefined)}</td>
                      <td>{pct(h.contCost > 0 ? f.gross / h.contCost : undefined)}</td>
                      <td>{pct(h.contCost > 0 ? f.net / h.contCost : undefined)}</td>
                      <td>{pct(h.brokerCost > 0 ? f.net / h.brokerCost : undefined)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l">合計</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td>{money(r.forecast.gross)}</td>
                  <td>{money(r.forecast.net)}</td>
                  <td>{pct(r.totals.marketValue ? r.forecast.gross / r.totals.marketValue : undefined)}</td>
                  <td>{pct(r.yoc.contGross)}</td>
                  <td>{pct(r.yoc.contNet)}</td>
                  <td>{pct(r.yoc.brokerNet)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="desc" style={{ marginTop: 6 }}>* 沒有實際預扣紀錄，使用預設稅率 {pct(store.settings.defaultWithholding, 0)}。</p>
        </Card>
      </div>

      <div className="section">
        <Card title="個股累積股利" desc="合併 Schwab 與複委託；含已出清的股票">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">代號</th>
                  <th className="l">期間</th>
                  <th>筆數</th>
                  <th>稅前</th>
                  <th>預扣稅</th>
                  <th>稅後</th>
                  <th>Schwab 稅後</th>
                  <th>複委託稅後</th>
                  <th className="l">稅務</th>
                </tr>
              </thead>
              <tbody>
                {symbols.map(([sym, s]) => (
                  <tr key={sym}>
                    <td className="l">
                      {sym}
                      {!holdingsBySym.has(sym) && <span className="muted">（已出清）</span>}
                    </td>
                    <td className="l">
                      {s.first} ~ {s.last}
                    </td>
                    <td>{s.totals.count}</td>
                    <td>{money(s.totals.gross)}</td>
                    <td>{money(s.totals.tax)}</td>
                    <td>{money(s.totals.net)}</td>
                    <td>{money(s.byBroker.schwab.net)}</td>
                    <td>{money(s.byBroker.tw.net)}</td>
                    <td className="l">
                      <TotalsBadge t={s.totals} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="section">
        <Card title="股利再投入增加的股數" desc="每筆再投入視為一次新的買進；只統計已匯入的交易紀錄期間">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">代號</th>
                  <th>再投入次數</th>
                  <th>增加股數</th>
                  <th>投入金額</th>
                  <th>這些股數目前市值</th>
                  <th>占目前持股</th>
                </tr>
              </thead>
              <tbody>
                {allDrip
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([sym, x]) => {
                    const h = holdingsBySym.get(sym);
                    return (
                      <tr key={sym}>
                        <td className="l">
                          {sym}
                          {!h && <span className="muted">（已出清）</span>}
                        </td>
                        <td>{x.count}</td>
                        <td>{qty(Number(x.qty.toFixed(4)))}</td>
                        <td>{money(x.cost)}</td>
                        <td>{h?.price != null ? money(x.qty * h.price) : '—'}</td>
                        <td>{h ? pct(x.qty / h.qty) : '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l">合計</td>
                  <td>{allDrip.reduce((a, [, x]) => a + x.count, 0)}</td>
                  <td />
                  <td>{money(allDrip.reduce((a, [, x]) => a + x.cost, 0))}</td>
                  <td>{money(dripRows.reduce((a, h) => a + h.drip!.qty * (h.price ?? 0), 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>

      <Card title="股利入帳明細">
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="field">
            代號
            <select value={symFilter} onChange={(e) => setSymFilter(e.target.value)}>
              <option value="">全部</option>
              {Object.keys(d.bySymbol)
                .sort()
                .map((s) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          </label>
          <span className="muted">{events.length} 筆</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 480 }}>
          <table>
            <thead>
              <tr>
                <th className="l">日期</th>
                <th className="l">券商</th>
                <th className="l">代號</th>
                <th>稅前</th>
                <th>預扣稅</th>
                <th>稅後</th>
                <th className="l">再投入</th>
                <th className="l">稅務</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="l">{e.date}</td>
                  <td className="l">{e.broker === 'schwab' ? 'Schwab' : '複委託'}</td>
                  <td className="l">{e.symbol}</td>
                  <td>{e.gross != null ? money(e.gross) : '—'}</td>
                  <td>{money(e.tax)}</td>
                  <td>{money(e.net)}</td>
                  <td className="l">{e.reinvested ? '是' : ''}</td>
                  <td className="l">{e.adjustment ? <span className="badge">稅務調整</span> : <TaxBadge status={e.taxStatus} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
