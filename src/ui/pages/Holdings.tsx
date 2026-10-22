import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { PageProps } from '../../App';
import type { HoldingRow } from '../../engine/report';
import { Card, Gain, Notice, Seg } from '../components';
import { brokerCostName, costHint, costTerms, schwabHolds } from '../costTerms';
import { holdingsCsv, holdingsMarkdown } from '../exportHoldings';
import type { QuotesApi } from '../../quotes/useQuotes';
import type { Analytics } from '../../perf/useAnalytics';
import { QuotesButton, quotesStatus } from '../QuotesBar';
import { money, moneyIn, pct, qty, today } from '../format';

type View = 'all' | 'broker' | 'cont';
type Dir = 'asc' | 'desc';

interface Col {
  key: string;
  label: string;
  group?: 'broker' | 'cont';
  text?: boolean; // 文字欄：預設升冪、靠左
  hint?: string; // 滑過欄位名稱時的說明
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

// 欄位順序與顯示：每台裝置各自記住（和外觀設定一樣，不同步）。代號固定在最前面。
const PREF_KEY = 'holdingsColumns';
const NAME_KEY = 'holdingsShowName';
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 無痕模式等情況存不了：只影響下次開啟
  }
}
interface ColPref {
  order: string[];
  hidden: string[];
}
function loadPref(): ColPref {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '');
    if (Array.isArray(v?.order) && Array.isArray(v?.hidden)) return v;
  } catch {
    // 沒存過或無法讀取：用預設
  }
  return { order: [], hidden: [] };
}
function savePref(p: ColPref) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // 無痕模式等情況存不了，只影響下次開啟
  }
}
// 記住的順序在前，之後新增的欄位照預設順序接在後面
function arrange(cols: Col[], order: string[]): Col[] {
  const [first, ...rest] = cols;
  const known = order.map((k) => rest.find((c) => c.key === k)).filter((c): c is Col => !!c);
  return [first, ...known, ...rest.filter((c) => !order.includes(c.key))];
}

export function Holdings({ report: r, quotes, analytics }: PageProps & { quotes?: QuotesApi; analytics?: Analytics }) {
  const [view, setView] = useState<View>('all');
  const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: 'marketValue', dir: 'desc' });
  const [msg, setMsg] = useState<string[]>([]);
  const [pref, setPrefState] = useState<ColPref>(loadPref);
  const [picking, setPicking] = useState(false);
  const [showName, setShowNameState] = useState(() => readLocal(NAME_KEY) !== '0');
  const setShowName = (on: boolean) => (setShowNameState(on), writeLocal(NAME_KEY, on ? '1' : '0'));
  const betas = analytics?.beta?.bySymbol ?? {};
  const setPref = (p: ColPref) => (setPrefState(p), savePref(p));
  const t = r.totals;
  const holds = schwabHolds(r.holdings);
  const B = brokerCostName(holds); // Schwab 已清空時就是「永豐成本」
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
          {showName && (
            <div className="muted" style={{ fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {h.name}
            </div>
          )}
        </>
      ),
      foot: '合計',
    },
    { key: 'sector', label: '產業', text: true, sortValue: (h) => h.sector, cell: (h) => h.sector },
    { key: 'currency', label: '幣別', text: true, sortValue: (h) => h.currency, cell: (h) => (h.currency === 'TWD' ? '台幣' : '美元') },
    { key: 'qty', label: '股數', sortValue: (h) => h.qty, cell: (h) => qty(Number(h.qty.toFixed(4))) },
    { key: 'price', label: '現價', hint: '最近一次匯入或輸入的價格（原幣）；滑過價格看日期', sortValue: (h) => (h.price ?? -Infinity) / (h.currency === 'TWD' ? (r.fx?.rate ?? 1) : 1), cell: (h) => (h.price != null ? moneyIn(h.price, h.currency) : '—') },
    { key: 'marketValue', label: '市值', sortValue: (h) => h.marketValue, cell: (h) => money(h.marketValue), foot: money(t.marketValue) },
    { key: 'weight', label: '比重', sortValue: (h) => h.weight, cell: (h) => pct(h.weight, 1), foot: '100%' },
    {
      key: 'beta',
      label: 'Beta',
      hint: '相對 S&P 500 的 Beta：近 5 年月報酬（含息）；有美股 ADR 的台股用 ADR（2330 用 TSM），其他台股換成美元計算。合計＝依市值加權（現金以 0 計）',
      sortValue: (h) => betas[h.symbol] ?? -Infinity,
      cell: (h) => (betas[h.symbol] != null ? betas[h.symbol].toFixed(2) : '—'),
      foot: analytics?.beta?.portfolio != null ? analytics.beta.portfolio.toFixed(2) : '',
    },
    // 券商帳上的成本；Schwab 清空後只剩永豐
    ...(holds
      ? ([
          { key: 'schwabCost', label: 'Schwab 成本', hint: costHint(holds, 'Schwab 成本'), group: 'broker', sortValue: (h) => h.schwabCost, cell: (h) => (h.schwabQty > 0 ? money(h.schwabCost) : '—'), foot: money(schwabCostTotal) },
          { key: 'twCost', label: '永豐成本', hint: costHint(holds, '永豐成本'), group: 'broker', sortValue: (h) => h.twCost, cell: (h) => (h.twQty > 0 ? money(h.twCost) : '—'), foot: money(t.twCost) },
        ] satisfies Col[])
      : []),
    { key: 'brokerCost', label: B, hint: costHint(holds, B), group: 'broker', sortValue: (h) => h.brokerCost, cell: (h) => money(h.brokerCost), foot: money(t.brokerCost) },
    { key: 'brokerAvg', label: `${B.replace('成本', '')}均價`, hint: `${B} ÷ 股數（原幣）`, group: 'broker', sortValue: (h) => avg(h.brokerCost, h.qty), cell: (h) => moneyIn(avg(h.native.brokerCost, h.qty), h.currency) },
    {
      key: 'brokerGain',
      label: `帳面盈虧（${B}）`,
      hint: `市值 − ${B}`,
      group: 'broker',
      sortValue: (h) => h.brokerGain,
      cell: (h) => <Gain value={h.brokerGain} base={h.brokerCost} />,
      foot: <Gain value={t.brokerGain} base={t.brokerCost} />,
    },
    {
      key: 'brokerYoc',
      label: `成本殖利率（${B}・稅後）`,
      hint: `未來 12 個月預估稅後股息 ÷ ${B}`,
      group: 'broker',
      sortValue: (h) => ratio(h.forecast.net, h.brokerCost),
      cell: (h) => pct(h.brokerCost > 0 ? h.forecast.net / h.brokerCost : undefined),
      foot: pct(r.yoc.brokerNet),
    },
    // 延續成本：從第一次買進算起
    { key: 'contCost', label: '延續成本', hint: costHint(holds, '延續成本'), group: 'cont', sortValue: (h) => h.contCost, cell: (h) => money(h.contCost), foot: money(t.contCost) },
    { key: 'contAvg', label: '延續均價', hint: '延續成本 ÷ 股數（原幣）', group: 'cont', sortValue: (h) => avg(h.contCost, h.qty), cell: (h) => moneyIn(avg(h.native.contCost, h.qty), h.currency) },
    {
      key: 'contGain',
      label: '帳面盈虧（延續成本）',
      hint: '市值 − 延續成本',
      group: 'cont',
      sortValue: (h) => h.contGain,
      cell: (h) => <Gain value={h.contGain} base={h.contCost} />,
      foot: <Gain value={t.contGain} base={t.contCost} />,
    },
    {
      key: 'contYoc',
      label: '成本殖利率（延續成本・稅後）',
      hint: '未來 12 個月預估稅後股息 ÷ 延續成本',
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
  const ordered = arrange(cols, pref.order);
  const visible = ordered.filter((c) => !pref.hidden.includes(c.key) && (!c.group || view === 'all' || c.group === view));

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

  function move(key: string, d: -1 | 1) {
    const keys = ordered.slice(1).map((c) => c.key);
    const i = keys.indexOf(key);
    const j = i + d;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setPref({ ...pref, order: keys });
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
    <Card title="持股明細">
      <div className="row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: '全部欄位' },
            { value: 'broker', label: `只看${B}` },
            { value: 'cont', label: '只看延續成本' },
          ]}
        />
        <div className="row">
          {quotes && <QuotesButton quotes={quotes} />}
          <button onClick={() => setPicking((x) => !x)} aria-expanded={picking}>
            {picking ? '完成' : '調整欄位'}
          </button>
          <button className="primary" onClick={copyForClaude}>
            複製給 Claude 分析
          </button>
          <button onClick={() => download(`持股明細-${today()}.csv`, holdingsCsv(rows), 'text/csv')}>下載 CSV</button>
        </div>
      </div>
      {picking && (
        <div className="colpicker">
          <p className="desc">用 ↑ ↓ 調整順序、取消勾選隱藏欄位；只記在這台裝置。代號固定在最前面。</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '6px 0' }}>
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            代號下方顯示公司名稱（取消後代號欄會變窄）
          </label>
          <ol>
            {ordered.slice(1).map((c, i, all) => (
              <li key={c.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={!pref.hidden.includes(c.key)}
                    onChange={(e) => setPref({ ...pref, hidden: e.target.checked ? pref.hidden.filter((k) => k !== c.key) : [...pref.hidden, c.key] })}
                  />
                  {c.label}
                </label>
                <span>
                  <button aria-label={`${c.label} 往前`} disabled={i === 0} onClick={() => move(c.key, -1)}>
                    ↑
                  </button>
                  <button aria-label={`${c.label} 往後`} disabled={i === all.length - 1} onClick={() => move(c.key, 1)}>
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <button onClick={() => setPref({ order: [], hidden: [] })}>恢復預設</button>
        </div>
      )}
      {quotes && <p className="desc" style={{ margin: '0 0 8px' }}>{quotesStatus(quotes)}</p>}
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
                    title={c.hint}
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
      <details className="defs-fold">
        <summary>名詞說明：{costTerms(holds).map((c) => c.name).join('、')}</summary>
        <dl className="defs">
          {costTerms(holds).map((c) => (
            <Fragment key={c.name}>
              <dt>{c.name}</dt>
              <dd>{c.what}</dd>
              <dd className="use">用途：{c.use}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
      <p className="desc" style={{ marginTop: 8 }}>
        匯出檔只在這台裝置產生，不會上傳。
      </p>
    </Card>
  );
}
