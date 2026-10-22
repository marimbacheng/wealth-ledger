import type { PageProps } from '../../App';
import { DividendYearChart, GradientDonut, ValueChart } from '../charts';
import { HOLDING_RAMP, SECTOR_RAMP } from '../color';
import { Gain, Kpi, Leaders, Notice, Section, TotalsBadge } from '../components';
import { money, pct, tone } from '../format';

export function Overview({ report: r, store }: PageProps) {
  const t = r.totals;
  const tr = r.totalReturn;
  const hasTw = t.twCost > 0 || r.dividends.twYtd.count > 0;
  const schwabCost = t.brokerCost - t.twCost;
  const hasSchwab = t.schwabValue > 0;
  const lastYear = r.dividends.byYear[r.dividends.byYear.length - 1];
  const priceDates = [...new Set(r.holdings.map((h) => h.priceDate).filter(Boolean))].sort();
  const costGap = t.contCost - t.brokerCost;

  return (
    <>
      <Notice title="需要注意" items={r.warnings} />

      <Section no="01" title="累積報酬" aside={priceDates.length ? `價格日 ${priceDates[priceDates.length - 1]}` : undefined}>
        <div className="split">
          <div>
            <Kpi hero label="跨券商累積報酬（已匯入資料的部分）" value={<Gain value={tr.total} />} />
            <Leaders
              rows={[
                { k: '未實現（延續成本）', v: money(tr.unrealized, { sign: true }), cls: tone(tr.unrealized) },
                { k: '已實現', v: money(tr.realized, { sign: true }), cls: tone(tr.realized) },
                Math.abs(tr.pendingMigration) > 0.005 && { k: '遷移中（已賣出待買回）', v: money(tr.pendingMigration, { sign: true }), cls: tone(tr.pendingMigration) },
                { k: '累積股利・稅後', v: money(tr.dividendsNet) },
                tr.interest !== 0 && { k: '利息', v: money(tr.interest) },
                tr.fees !== 0 && { k: '帳外費用', v: money(-tr.fees) },
                { k: '合計', v: money(tr.total, { sign: true }), cls: tone(tr.total), total: true },
              ]}
            />
          </div>
          <div className="stack">
            <Kpi label="目前總值" value={money(t.totalValue)} foot={`持股 ${money(t.marketValue)}　現金 ${money(t.schwabCash + t.twCash)}`} />
            {tr.netContribution != null ? (
              <Leaders
                rows={[
                  { k: '累計淨投入', v: money(tr.netContribution) },
                  { k: '現值 − 淨投入', v: money(tr.gainByContribution, { sign: true }), cls: tone(tr.gainByContribution) },
                  { k: '年化報酬（XIRR）', v: pct(tr.xirr) },
                  { k: '未歸因差額', v: money(tr.residual, { sign: true }), cls: 'muted' },
                ]}
              />
            ) : (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                到「設定」填入期初累計淨投入，這裡會加上「現值 − 淨投入」與年化報酬率（XIRR）。
              </p>
            )}
            <Kpi label={`未來 12 個月預估股息・稅後（${r.forecast.label}）`} value={money(r.forecast.net)} foot={`稅前 ${money(r.forecast.gross)}，預扣 ${money(r.forecast.tax)}`} />
          </div>
        </div>
      </Section>

      <Section no="02" title="成本" aside="券商成本拿來報稅與對帳；延續成本拿來看從第一次買進到現在的報酬">
        <div className="grid">
          <div>
            <div className="eyebrow">券商成本・兩家券商帳上</div>
            <Leaders
              rows={[
                { k: 'Schwab 成本', v: hasSchwab ? money(schwabCost) : '已全數轉出' },
                { k: '永豐成本', v: hasTw ? money(t.twCost) : '尚未買進' },
                { k: '券商成本', v: money(t.brokerCost), total: true },
                { k: '帳面盈虧', v: <Gain value={t.brokerGain} base={t.brokerCost} /> },
                { k: '成本殖利率・稅後', v: pct(r.yoc.brokerNet) },
              ]}
            />
          </div>
          <div>
            <div className="eyebrow">延續成本・從第一次買進算起</div>
            <Leaders
              rows={[
                { k: '延續成本', v: money(t.contCost) },
                { k: '市值', v: money(t.marketValue) },
                { k: '帳面盈虧', v: <Gain value={t.contGain} base={t.contCost} />, total: true },
                { k: '成本殖利率・稅後', v: pct(r.yoc.contNet) },
              ]}
            />
          </div>
          <div>
            <div className="eyebrow">差異</div>
            <Leaders
              rows={[
                { k: '延續成本 − 券商成本', v: money(costGap, { sign: true }) },
                { k: '遷移配對筆數', v: String(r.migration.matches.length) },
              ]}
            />
            <p className="muted" style={{ fontSize: 12 }}>
              遷移前兩者相同。在永豐買回後，券商成本變成永豐的新買進成本；延續成本保留 Schwab 時期的原始成本，再加上賣出與買回之間的價差和手續費。
            </p>
          </div>
        </div>
      </Section>

      <Section no="03" title="配置">
        <div className="grid two">
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              持股比例・依市值
            </div>
            <GradientDonut
              data={r.holdings.map((h) => ({ name: h.symbol, sub: h.name, value: h.marketValue, weight: h.weight }))}
              spec={HOLDING_RAMP}
              centerLabel={`${r.holdings.length} 檔持股`}
              centerValue={money(t.marketValue, { whole: true })}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              產業分布・含現金
            </div>
            <GradientDonut data={r.sectors} spec={SECTOR_RAMP} centerLabel={`${r.sectors.length} 個類別`} centerValue={money(t.totalValue, { whole: true })} />
          </div>
        </div>
      </Section>

      <Section no="04" title="股利" aside={<TotalsBadge t={r.dividends.total} />}>
        <div className="split">
          <div>
            <DividendYearChart
              data={r.dividends.byYear.map((y) => ({ year: String(y.year), net: y.totals.net, tax: y.totals.tax, estimated: y.totals.estimatedCount > 0 }))}
            />
          </div>
          <div>
            <Leaders
              rows={[
                { k: '累積稅前', v: money(r.dividends.total.gross) },
                { k: '累積預扣稅', v: money(r.dividends.total.tax) },
                { k: '累積稅後', v: money(r.dividends.total.net), total: true },
                lastYear && { k: `${lastYear.year} 年合計實領`, v: money(lastYear.totals.net) },
                { k: `${r.dividends.year} 年永豐實領`, v: money(r.dividends.twYtd.net) },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section no="05" title="資產成長" aside={r.valueSeries.length < 3 ? '資料點還很少；可在「設定」補登過去對帳單的月底總值' : undefined}>
        {r.valueSeries.length > 0 ? <ValueChart data={r.valueSeries} /> : <p className="muted">尚無資產快照</p>}
      </Section>

      <Section no="06" title="資料涵蓋範圍" aside="累積數字只包含已匯入的期間">
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
                  <td className="l">{s.broker === 'schwab' ? 'Schwab' : '永豐'} 持倉快照</td>
                  <td />
                  <td>{s.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
