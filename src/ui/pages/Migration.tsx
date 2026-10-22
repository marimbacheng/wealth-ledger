import type { PageProps } from '../../App';
import type { Currency } from '../../domain/types';
import { Card, Leaders } from '../components';
import { brokerCostName, costGapNote, schwabHolds } from '../costTerms';
import { money, moneyIn, qty } from '../format';

// 移轉紀錄：Schwab → 永豐那一次搬家的明細。日常不需要看，留著備查（為什麼延續成本和永豐成本不同、零股去哪了）。
export function Migration({ report: r, store }: PageProps) {
  const { matches, pending } = r.migration;
  const rate = r.fx?.rate;
  const usd = (n: number, c: Currency) => (c === 'USD' ? n : rate ? n / rate : 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const holds = schwabHolds(r.holdings);
  const B = brokerCostName(holds);
  const t = r.totals;

  if (!matches.length && !pending.length) {
    return (
      <Card title="移轉紀錄">
        <p className="muted">還沒有 Schwab 賣出與永豐買回的配對。遷移期間在「匯入與設定」的遷移設定。</p>
      </Card>
    );
  }

  const span = (ds: string[]) => {
    const u = [...new Set(ds)].sort();
    return u.length ? (u.length > 1 ? `${u[0]} ～ ${u[u.length - 1]}` : u[0]) : '—';
  };
  const carried = sum(matches.map((m) => usd(m.proceeds - m.originalCost, m.currency)));
  const rebuy = sum(matches.map((m) => usd(m.newCost - m.proceeds, m.currency)));
  const pendProceeds = sum(pending.map((p) => usd(p.proceeds, p.currency)));
  const pendGain = sum(pending.map((p) => usd(p.proceeds - p.originalCost, p.currency)));
  const rows = [...matches].sort((a, b) => usd(b.proceeds - b.originalCost, b.currency) - usd(a.proceeds - a.originalCost, a.currency));

  return (
    <>
      <Card title="移轉摘要" desc="Schwab 全數賣出、在永豐買回的那一次搬家。日常不需要看，留著備查。">
        <div className="grid two">
          <Leaders
            rows={[
              { k: 'Schwab 賣出', v: span([...matches.map((m) => m.sellDate), ...pending.map((p) => p.sellDate)]) },
              { k: '永豐買回', v: span(matches.map((m) => m.buyDate)) },
              { k: '配對筆數', v: String(matches.length) },
              { k: '還沒買回的零股', v: pending.length ? `${pending.length} 檔，賣出所得 ${money(pendProceeds)}` : '無' },
            ]}
          />
          <Leaders
            rows={[
              { k: '移轉前在 Schwab 已賺到（賣出所得 − 原始成本）', v: money(carried, { sign: true }) },
              { k: `延續成本 − ${B}（＝上一列的負數）`, v: money(t.contCost - t.brokerCost, { sign: true }) },
              { k: '買回差價與手續費（兩種成本都含，不影響差異）', v: money(rebuy, { sign: true }) },
              pending.length > 0 && { k: '零股的損益（計入總報酬的「遷移中」）', v: money(pendGain, { sign: true }) },
            ]}
          />
        </div>
        <p className="desc" style={{ marginTop: 8 }}>
          {costGapNote(holds)}
        </p>
      </Card>

      <Card title="每一組配對" desc="同代號賣出又買回，或換成其他代號買回（例如 TSM → 2330）。金額用原幣別；合計依頁首選的幣別。">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="l">代號</th>
                <th>股數</th>
                <th>原始成本</th>
                <th>Schwab 賣出所得</th>
                <th>永豐買進成本</th>
                <th>延續成本</th>
                <th>已賺到（賣出 − 原始）</th>
                <th>買回差價（買進 − 賣出）</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={i}>
                  <td className="l">{x.fromSymbol && x.fromSymbol !== x.symbol ? `${x.fromSymbol} → ${x.symbol}` : x.symbol}</td>
                  <td>{qty(Number(x.qty.toFixed(4)))}</td>
                  <td>{moneyIn(x.originalCost, x.currency)}</td>
                  <td>{moneyIn(x.proceeds, x.currency)}</td>
                  <td>{moneyIn(x.newCost, x.currency)}</td>
                  <td>{moneyIn(x.carriedCost, x.currency)}</td>
                  <td>{moneyIn(x.proceeds - x.originalCost, x.currency, { sign: true })}</td>
                  <td>{moneyIn(x.newCost - x.proceeds, x.currency, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="l">合計</td>
                <td />
                <td>{money(sum(matches.map((m) => usd(m.originalCost, m.currency))))}</td>
                <td>{money(sum(matches.map((m) => usd(m.proceeds, m.currency))))}</td>
                <td>{money(sum(matches.map((m) => usd(m.newCost, m.currency))))}</td>
                <td>{money(sum(matches.map((m) => usd(m.carriedCost, m.currency))))}</td>
                <td>{money(carried, { sign: true })}</td>
                <td>{money(rebuy, { sign: true })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {pending.length > 0 && (
        <Card
          title="遷移中（已賣出、尚未買回）"
          desc={`沒買回的零股。買回期限（${store.settings.migration.twBuyTo}）前若在永豐買回會自動配對；期限過後在延續帳轉為已實現。`}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">代號</th>
                  <th>股數</th>
                  <th>賣出日</th>
                  <th>原始成本</th>
                  <th>賣出所得</th>
                  <th>損益</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.symbol + p.sellDate}>
                    <td className="l">{p.symbol}</td>
                    <td>{qty(Number(p.qty.toFixed(4)))}</td>
                    <td>{p.sellDate}</td>
                    <td>{moneyIn(p.originalCost, p.currency)}</td>
                    <td>{moneyIn(p.proceeds, p.currency)}</td>
                    <td>{moneyIn(p.proceeds - p.originalCost, p.currency, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l">合計</td>
                  <td />
                  <td />
                  <td>{money(sum(pending.map((p) => usd(p.originalCost, p.currency))))}</td>
                  <td>{money(pendProceeds)}</td>
                  <td>{money(pendGain, { sign: true })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
