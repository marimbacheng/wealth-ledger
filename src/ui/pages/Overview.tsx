import type { PageProps } from '../../App';
import { DividendYearChart, GradientDonut, GrowthChart, ValueChart } from '../charts';
import { HOLDING_RAMP, SECTOR_RAMP } from '../color';
import { Gain, Leaders, Notice, Section, TotalsBadge } from '../components';
import { brokerCostName, schwabHolds } from '../costTerms';
import { money, pct, tone } from '../format';
import type { Analytics } from '../../perf/useAnalytics';
import { StatTiles, TotalValueHero } from '../StatTiles';
import { YearTable } from '../YearTable';

export function Overview({ report: r, store, analytics: a }: PageProps & { analytics?: Analytics }) {
  const t = r.totals;
  const tr = r.totalReturn;
  const hasTw = t.twCost > 0 || r.dividends.twYtd.count > 0;
  const schwabCost = t.brokerCost - t.twCost;
  const holds = schwabHolds(r.holdings);
  const B = brokerCostName(holds);
  const lastYear = r.dividends.byYear[r.dividends.byYear.length - 1];
  const priceDates = [...new Set(r.holdings.map((h) => h.priceDate).filter(Boolean))].sort();

  return (
    <>
      <Notice title="需要注意" items={r.warnings} />

      <Section no="01" title="總值與報酬" aside={priceDates.length ? `價格日 ${priceDates[priceDates.length - 1]}` : undefined}>
        {/* 手機：大數字 → 四格 → 明細；桌機：大數字與明細左右並排，四格在下面一排 */}
        <div className="ov-top">
          <TotalValueHero r={r} />
          <StatTiles r={r} a={a} />
          <div className="ov-detail">
            <div className="eyebrow">累積報酬明細・已匯入資料的部分</div>
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
        </div>
      </Section>

      <Section no="02" title="成本" aside={`${B}拿來報稅與對帳；延續成本拿來看從第一次買進到現在的報酬；兩者的差異見「移轉紀錄」`}>
        <div className="grid two">
          <div>
            <div className="eyebrow">{holds ? '券商成本・兩家券商帳上' : '永豐成本・永豐帳上'}</div>
            <Leaders
              rows={[
                ...(holds
                  ? [
                      { k: 'Schwab 成本', v: money(schwabCost) },
                      { k: '永豐成本', v: hasTw ? money(t.twCost) : '尚未買進' },
                    ]
                  : []),
                { k: B, v: money(t.brokerCost), total: true },
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

      <Section no="05" title="資產成長" aside={a?.perf ? `用每日收盤價與交易紀錄重建，${a.from} 起（交易紀錄最早的日期）` : a?.busy ? '正在取得歷史價格…' : undefined}>
        {a?.perf?.chart.length ? (
          <GrowthChart data={a.perf.chart} />
        ) : r.valueSeries.length > 0 ? (
          <ValueChart data={r.valueSeries} />
        ) : (
          <p className="muted">尚無資產快照</p>
        )}
      </Section>

      <Section no="06" title="年度表現" aside="和 S&P 500、NASDAQ 同期比較">
        {a ? <YearTable a={a} /> : null}
      </Section>

      <Section no="07" title="資料涵蓋範圍" aside="累積數字只包含已匯入的期間">
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
