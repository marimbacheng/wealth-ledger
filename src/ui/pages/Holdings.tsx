import { useState } from 'react';
import type { PageProps } from '../../App';
import { Card, Gain, Seg } from '../components';
import { money, pct, qty } from '../format';

type View = 'cont' | 'broker' | 'both';

export function Holdings({ report: r }: PageProps) {
  const [view, setView] = useState<View>('both');
  const t = r.totals;
  const showCont = view !== 'broker';
  const showBroker = view !== 'cont';
  const twAny = r.holdings.some((h) => h.twQty > 0);
  const schwabAny = r.holdings.some((h) => h.schwabQty > 0);

  return (
    <Card
      title="持股明細"
      desc="歷史成本 = 延續帳（Schwab 原始成本延續到複委託）；券商成本 = 各券商帳上實際成本。成本殖利率以未來 12 個月預估稅後股息計算。"
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'both', label: '兩者並列' },
            { value: 'cont', label: '歷史成本' },
            { value: 'broker', label: '券商成本' },
          ]}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="l">代號</th>
              <th className="l">產業</th>
              <th>股數</th>
              {schwabAny && twAny && <th>Schwab / 複委託</th>}
              <th>現價</th>
              <th>市值</th>
              <th>比重</th>
              {showCont && (
                <>
                  <th>歷史成本</th>
                  <th>歷史均價</th>
                  <th>帳面盈虧（歷史）</th>
                  <th>成本殖利率（歷史・稅後）</th>
                </>
              )}
              {showBroker && (
                <>
                  <th>券商成本</th>
                  <th>券商均價</th>
                  <th>帳面盈虧（券商）</th>
                  <th>成本殖利率（券商・稅後）</th>
                </>
              )}
              <th>累積股利（稅後）</th>
              <th>預估年股息（稅後）</th>
            </tr>
          </thead>
          <tbody>
            {r.holdings.map((h) => (
              <tr key={h.symbol}>
                <td className="l" title={h.name}>
                  <strong>{h.symbol}</strong>
                  <div className="muted" style={{ fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.name}
                  </div>
                </td>
                <td className="l">{h.sector}</td>
                <td>{qty(h.qty)}</td>
                {schwabAny && twAny && (
                  <td>
                    {qty(h.schwabQty)} / {qty(h.twQty)}
                  </td>
                )}
                <td title={h.priceDate ? `價格日 ${h.priceDate}` : '沒有價格'}>{h.price != null ? money(h.price) : '—'}</td>
                <td>{money(h.marketValue)}</td>
                <td>{pct(h.weight, 1)}</td>
                {showCont && (
                  <>
                    <td>{money(h.contCost)}</td>
                    <td>{money(h.contCost / h.qty)}</td>
                    <td>
                      <Gain value={h.contGain} base={h.contCost} />
                    </td>
                    <td>{pct(h.contCost > 0 ? h.forecast.net / h.contCost : undefined)}</td>
                  </>
                )}
                {showBroker && (
                  <>
                    <td>{money(h.brokerCost)}</td>
                    <td>{money(h.brokerCost / h.qty)}</td>
                    <td>
                      <Gain value={h.brokerGain} base={h.brokerCost} />
                    </td>
                    <td>{pct(h.brokerCost > 0 ? h.forecast.net / h.brokerCost : undefined)}</td>
                  </>
                )}
                <td>{money(h.dividends?.net ?? 0)}</td>
                <td>{money(h.forecast.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="l">合計</td>
              <td />
              <td />
              {schwabAny && twAny && <td />}
              <td />
              <td>{money(t.marketValue)}</td>
              <td>100%</td>
              {showCont && (
                <>
                  <td>{money(t.contCost)}</td>
                  <td />
                  <td>
                    <Gain value={t.contGain} base={t.contCost} />
                  </td>
                  <td>{pct(r.yoc.contNet)}</td>
                </>
              )}
              {showBroker && (
                <>
                  <td>{money(t.brokerCost)}</td>
                  <td />
                  <td>
                    <Gain value={t.brokerGain} base={t.brokerCost} />
                  </td>
                  <td>{pct(r.yoc.brokerNet)}</td>
                </>
              )}
              <td>{money(r.holdings.reduce((a, h) => a + (h.dividends?.net ?? 0), 0))}</td>
              <td>{money(r.forecast.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="desc" style={{ marginTop: 8 }}>
        遷移前兩種成本相同（都是 Schwab 帳上成本）；在複委託買回後，券商成本會變成新買進成本，歷史成本則延續原始成本加上賣出與買回之間的價差與手續費。
      </p>
    </Card>
  );
}
