import { useMemo, useState, type ReactNode } from 'react';
import type { PageProps } from '../../App';
import type { HoldingRow } from '../../engine/report';
import { Card, Gain, Notice, Seg } from '../components';
import { holdingsCsv, holdingsMarkdown } from '../exportHoldings';
import { money, moneyIn, pct, qty, today } from '../format';

type View = 'all' | 'actual' | 'cont';
type Dir = 'asc' | 'desc';

interface Col {
  key: string;
  label: ReactNode;
  group?: 'actual' | 'cont';
  text?: boolean; // 文字欄：預設升冪、靠左
  sortValue: (h: HoldingRow) => number | string;
  cell: (h: HoldingRow) => ReactNode;
  foot?: ReactNode;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const avg = (cost: number, q: number) => (q > 0 ? cost / q : 0);
const ratio = (a: number, b: number) => (b > 0 ? a / b : -Infinity);

export function Holdings({ report: r }: PageProps) {
  const [view, setView] = useState<View>('all');
  const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: 'marketValue', dir: 'desc' });
  const [msg, setMsg] = useState<string[]>([]);
  const t = r.totals;
  const schwabCostTotal = t.brokerCost - t.twCost;

  const cols: Col[] = [
    {
      key: 'symbol',
      label: '代號',
      text: true,
      sortValue: (h) => h.symbol,
      cell: (h) => (
        <>
          <strong>{h.symbol}</strong>
          <div className="muted" style={{ fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {h.name}
          </div>
        </>
      ),
      foot: '合計',
    },
    { key: 'sector', label: '產業', text: true, sortValue: (h) => h.sector, cell: (h) => h.sector },
    { key: 'currency', label: '幣別', text: true, sortValue: (h) => h.currency, cell: (h) => (h.currency === 'TWD' ? '台幣' : '美元') },
    { key: 'qty', label: '股數', sortValue: (h) => h.qty, cell: (h) => qty(Number(h.qty.toFixed(4))) },
    { key: 'price', label: '現價', sortValue: (h) => (h.price ?? -Infinity) / (h.currency === 'TWD' ? (r.fx?.rate ?? 1) : 1), cell: (h) => (h.price != null ? moneyIn(h.price, h.currency) : '—') },
    { key: 'marketValue', label: '市值', sortValue: (h) => h.marketValue, cell: (h) => money(h.marketValue), foot: money(t.marketValue) },
    { key: 'weight', label: '比重', sortValue: (h) => h.weight, cell: (h) => pct(h.weight, 1), foot: '100%' },
    // 實際成本：各券商帳上
    { key: 'schwabCost', label: 'Schwab 成本', group: 'actual', sortValue: (h) => h.schwabCost, cell: (h) => (h.schwabQty > 0 ? money(h.schwabCost) : '—'), foot: money(schwabCostTotal) },
    { key: 'twCost', label: '永豐成本', group: 'actual', sortValue: (h) => h.twCost, cell: (h) => (h.twQty > 0 ? money(h.twCost) : '—'), foot: money(t.twCost) },
    { key: 'brokerCost', label: '總成本', group: 'actual', sortValue: (h) => h.brokerCost, cell: (h) => money(h.brokerCost), foot: money(t.brokerCost) },
    { key: 'brokerAvg', label: '均價', group: 'actual', sortValue: (h) => avg(h.brokerCost, h.qty), cell: (h) => moneyIn(avg(h.native.brokerCost, h.qty), h.currency) },
    {
      key: 'brokerGain',
      label: '帳面盈虧（總成本）',
      group: 'actual',
      sortValue: (h) => h.brokerGain,
      cell: (h) => <Gain value={h.brokerGain} base={h.brokerCost} />,
      foot: <Gain value={t.brokerGain} base={t.brokerCost} />,
    },
    {
      key: 'brokerYoc',
      label: '成本殖利率（總成本・稅後）',
      group: 'actual',
      sortValue: (h) => ratio(h.forecast.net, h.brokerCost),
      cell: (h) => pct(h.brokerCost > 0 ? h.forecast.net / h.brokerCost : undefined),
      foot: pct(r.yoc.brokerNet),
    },
    // 延續成本：含 Schwab 時期
    { key: 'contCost', label: '延續成本', group: 'cont', sortValue: (h) => h.contCost, cell: (h) => money(h.contCost), foot: money(t.contCost) },
    { key: 'contAvg', label: '延續均價', group: 'cont', sortValue: (h) => avg(h.contCost, h.qty), cell: (h) => moneyIn(avg(h.native.contCost, h.qty), h.currency) },
    {
      key: 'contGain',
      label: '帳面盈虧（延續成本）',
      group: 'cont',
      sortValue: (h) => h.contGain,
      cell: (h) => <Gain value={h.contGain} base={h.contCost} />,
      foot: <Gain value={t.contGain} base={t.contCost} />,
    },
    {
      key: 'contYoc',
      label: '成本殖利率（延續成本・稅後）',
      group: 'cont',
      sortValue: (h) => ratio(h.forecast.net, h.contCost),
      cell: (h) => pct(h.contCost > 0 ? h.forecast.net / h.contCost : undefined),
      foot: pct(r.yoc.contNet),
    },
    {
      key: 'divNet',
      label: '累積股利（稅後）',
      sortValue: (h) => h.dividends?.net ?? 0,
      cell: (h) => money(h.dividends?.net ?? 0),
      foot: money(r.holdings.reduce((a, h) => a + (h.dividends?.net ?? 0), 0)),
    },
    { key: 'fwdNet', label: '預估年股息（稅後）', sortValue: (h) => h.forecast.net, cell: (h) => money(h.forecast.net), foot: money(r.forecast.net) },
  ];
  const visible = cols.filter((c) => !c.group || view === 'all' || c.group === view);

  const rows = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...r.holdings].sort((a, b) => {
      const x = col.sortValue(a);
      const y = col.sortValue(b);
      const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'zh-Hant') : x - y;
      return c * sign || a.symbol.localeCompare(b.symbol);
    });
    // cols 每次 render 重建但內容只依 r 而定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, sort]);

  function toggle(c: Col) {
    setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.text ? 'asc' : 'desc' }));
  }

  async function copyForClaude() {
    const md = holdingsMarkdown(r, rows);
    try {
      await navigator.clipboard.writeText(md);
      setMsg(['已複製持股明細（Markdown）。貼到和 Claude 的對話裡，再說明想分析什麼即可。']);
    } catch {
      download(`持股明細-${today()}.md`, md, 'text/markdown');
      setMsg(['瀏覽器不允許寫入剪貼簿，已改為下載 Markdown 檔，可直接附加給 Claude。']);
    }
  }

  return (
    <Card
      title="持股明細"
      desc="總成本 = 各券商帳上的實際成本（Schwab＋永豐），用於報稅與對帳；延續成本 = Schwab 時期的原始成本延續到永豐，用於長期報酬與成本殖利率。現價、均價用原幣別；其餘金額依頁首選的幣別顯示（台股依匯率換算）。點欄位名稱可排序。"
    >
      <div className="row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: '全部' },
            { value: 'actual', label: '實際成本' },
            { value: 'cont', label: '延續成本' },
          ]}
        />
        <div className="row">
          <button className="primary" onClick={copyForClaude}>
            複製給 Claude 分析
          </button>
          <button onClick={() => download(`持股明細-${today()}.csv`, holdingsCsv(rows), 'text/csv')}>下載 CSV</button>
        </div>
      </div>
      <Notice items={msg} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {visible.map((c) => {
                const on = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`sortable ${c.text ? 'l' : ''} ${on ? 'on' : ''}`}
                    aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggle(c)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(c))}
                    tabIndex={0}
                    scope="col"
                  >
                    {c.label}
                    <span className="arrow" aria-hidden>
                      {on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.symbol}>
                {visible.map((c) => (
                  <td key={c.key} className={c.text ? 'l' : ''} title={c.key === 'price' && h.priceDate ? `價格日 ${h.priceDate}` : c.key === 'symbol' ? h.name : undefined}>
                    {c.cell(h)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {visible.map((c) => (
                <td key={c.key} className={c.text ? 'l' : ''}>
                  {c.foot ?? ''}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="desc" style={{ marginTop: 8 }}>
        遷移前，總成本就是 Schwab 帳上成本，和延續成本相同。在永豐買回後，總成本變成永豐的新買進成本；延續成本保留 Schwab 時期的原始成本，再加上賣出與買回之間的價差和手續費。匯出檔只在這台裝置產生，不會上傳。
      </p>
    </Card>
  );
}
