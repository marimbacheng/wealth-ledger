import { afterEach, vi } from 'vitest';
import { currencyOf, rateAt } from '../src/domain/currency';
import { emptyStore, type Store, type Txn } from '../src/domain/types';
import { computeLedgers } from '../src/engine/ledger';
import { buildReport } from '../src/engine/report';
import { fetchUsdTwd } from '../src/fx/fetchFx';
import { importText } from '../src/import';
import { merge3 } from '../src/sync/merge3';

// 合成數字：Schwab 持有 8 股 TSM（原始成本 1,600 USD），賣出得 2,400 USD；
// 台股原有 20 股 2330（成本 10,000 TWD），遷移時在永豐買 45 股 2330，付出 90,150 TWD（含手續費 150），當天匯率 32.5
let seq = 0;
const tx = (p: Partial<Txn> & Pick<Txn, 'broker' | 'date' | 'type' | 'amount'>): Txn =>
  ({ id: `c${seq++}`, source: p.broker === 'tw' ? 'tw-csv' : 'schwab-transactions', ...p }) as Txn;

const FX = 32.5;
const DEFERRED_TWD = (2400 - 1600) * FX;

function tsmStore(opts: { buyFirst?: boolean; fx?: number | null } = {}): Store {
  const s = emptyStore();
  s.snapshots.push({
    id: 'schwab|2026-10-19',
    broker: 'schwab',
    date: '2026-10-19',
    cash: 0,
    total: 0,
    source: 't',
    rows: [{ symbol: 'TSM', name: 'TSM', qty: 8, price: 300, costBasis: 1600, marketValue: 0 }],
  });
  if (opts.fx !== null) s.fx = { current: { rate: opts.fx ?? FX, date: '2026-10-21', source: 't' }, history: { '2026-10-21': opts.fx ?? FX } };
  s.prices = { '2330': { price: 2100, date: '2026-10-22', source: 't' } };
  s.txns = [
    tx({ broker: 'schwab', date: opts.buyFirst ? '2026-10-23' : '2026-10-20', type: 'SELL', symbol: 'TSM', qty: 8, amount: 2400 }),
    tx({ broker: 'tw', date: '2026-10-15', type: 'OPEN', symbol: '2330', qty: 20, amount: -10000 }),
    tx({ broker: 'tw', date: '2026-10-21', type: 'BUY', symbol: '2330', qty: 45, price: 2000, fee: 150, amount: -90150 }),
  ];
  return s;
}

describe('幣別判斷', () => {
  it('數字代號是台股（TWD），其他是 USD；可用設定覆寫', () => {
    expect(currencyOf('2330')).toBe('TWD');
    expect(currencyOf('006208')).toBe('TWD');
    expect(currencyOf('00679B')).toBe('TWD');
    expect(currencyOf('TSM')).toBe('USD');
    expect(currencyOf('BRK.B')).toBe('USD');
    expect(currencyOf('XYZ', { XYZ: { currency: 'TWD' } })).toBe('TWD');
  });

  it('指定日期沒有匯率時，用之前最近一天，再沒有就用目前匯率', () => {
    const s = emptyStore();
    s.fx = { current: { rate: 33, date: '2026-10-22', source: 't' }, history: { '2026-10-01': 31.9, '2026-10-15': 32.1 } };
    expect(rateAt(s, '2026-10-15')).toBe(32.1);
    expect(rateAt(s, '2026-10-18')).toBe(32.1);
    expect(rateAt(s, '2026-09-01')).toBe(33);
  });
});

describe('TSM（美股 ADR）→ 2330（台股）遷移', () => {
  it('1 股 TSM = 5 股 2330；TSM 原始成本換成台幣後，和原有持股合併接到 2330', () => {
    const led = computeLedgers(tsmStore(), '2026-10-22');
    expect(led.pending).toHaveLength(0);
    expect(led.matches).toHaveLength(1);
    const m = led.matches[0];
    expect(m).toMatchObject({ fromSymbol: 'TSM', symbol: '2330', currency: 'TWD', fx: FX });
    expect(m.qty).toBeCloseTo(40, 6);
    expect(m.sellQty).toBeCloseTo(8, 6);
    expect(m.originalCost).toBeCloseTo(1600 * FX, 2);
    expect(m.carriedCost).toBeCloseTo(90150 * (40 / 45) - DEFERRED_TWD, 2);
    // 延續帳：原有 20 股 + 新買 45 股，成本 = 10,000 + 90,150 − 遞延損益（台幣）
    expect(led.continuous['2330'].qty).toBeCloseTo(65, 6);
    expect(led.continuous['2330'].cost).toBeCloseTo(10000 + 90150 - DEFERRED_TWD, 2);
    // 券商帳照實：永豐台股成本 = 期初 + 新買
    expect(led.tw['2330'].cost).toBeCloseTo(100150, 2);
    expect(led.continuous.TSM).toBeUndefined();
  });

  it('先買 2330、後賣 TSM，結果相同', () => {
    const a = computeLedgers(tsmStore(), '2026-10-25').continuous['2330'].cost;
    const b = computeLedgers(tsmStore({ buyFirst: true }), '2026-10-25').continuous['2330'].cost;
    expect(b).toBeCloseTo(a, 6);
  });

  it('期初持股不動現金；台幣現金只反映台股買進', () => {
    const led = computeLedgers(tsmStore(), '2026-10-22');
    expect(led.twCashTWD).toBeCloseTo(-90150, 2);
    expect(led.twCash).toBe(0);
  });

  it('沒有匯率時不硬接：提醒並把 TSM 留在遷移中', () => {
    const led = computeLedgers(tsmStore({ fx: null }), '2026-10-22');
    expect(led.warnings.some((w) => w.includes('匯率'))).toBe(true);
    expect(led.pending.map((p) => p.symbol)).toEqual(['TSM']);
  });
});

describe('報表換算成美元', () => {
  it('台股市值、成本用目前匯率換成美元；台股股利預扣預設 0%', () => {
    const r = buildReport(tsmStore(), '2026-10-22');
    const h = r.holdings.find((x) => x.symbol === '2330')!;
    expect(h.currency).toBe('TWD');
    expect(h.native.marketValue).toBeCloseTo(65 * 2100, 2);
    expect(h.marketValue).toBeCloseTo((65 * 2100) / FX, 2);
    expect(h.native.brokerCost).toBeCloseTo(100150, 2);
    expect(h.brokerCost).toBeCloseTo(100150 / FX, 2);
    expect(h.forecast.rate).toBe(0);
    expect(r.fx?.rate).toBe(FX);
    expect(r.totals.twCashTWD).toBeCloseTo(-90150, 2);
    expect(r.warnings.some((w) => w.includes('永豐台幣現金推算為'))).toBe(true);
  });

  it('期初持股以成本算進淨投入：只有期初持股時，「現值 − 淨投入」等於帳面盈虧', () => {
    const s = emptyStore();
    s.fx = { current: { rate: FX, date: '2026-10-21', source: 't' }, history: { '2026-10-15': FX } };
    s.prices = { '006208': { price: 150, date: '2026-10-22', source: 't' } };
    s.txns = [tx({ broker: 'tw', date: '2026-10-15', type: 'OPEN', symbol: '006208', qty: 50, amount: -5000 })];
    s.settings.openingContribution = { date: '2026-01-01', amount: 0 };
    const tr = buildReport(s, '2026-10-22').totalReturn;
    expect(tr.netContribution).toBeCloseTo(5000 / FX, 4);
    expect(tr.total).toBeCloseTo((50 * 150 - 5000) / FX, 4);
    expect(tr.residual).toBeCloseTo(0, 6);
  });

  it('台股用近 12 個月實領估股利時，每股股利是台幣、合計只換算一次', () => {
    const s = emptyStore();
    s.fx = { current: { rate: FX, date: '2026-10-21', source: 't' }, history: {} };
    s.prices = { '2330': { price: 1000, date: '2026-10-22', source: 't' } };
    s.txns = [
      tx({ broker: 'tw', date: '2026-01-15', type: 'OPEN', symbol: '2330', qty: 10, amount: -5000 }),
      tx({ broker: 'tw', date: '2026-07-15', type: 'DIV', symbol: '2330', amount: 50 }),
    ];
    const f = buildReport(s, '2026-10-22').forecast.rows.find((x) => x.symbol === '2330')!;
    expect(f).toMatchObject({ dpsSource: 'ttm', currency: 'TWD' });
    expect(f.dps).toBeCloseTo(5, 6);
    expect(f.gross).toBeCloseTo(50 / FX, 6);
  });

  it('沒有匯率時提醒，台幣部位以 0 計入合計', () => {
    const r = buildReport(tsmStore({ fx: null }), '2026-10-22');
    expect(r.warnings.some((w) => w.includes('尚未取得美元／台幣匯率'))).toBe(true);
    expect(r.holdings.find((x) => x.symbol === '2330')!.marketValue).toBe(0);
  });
});

describe('永豐範本：幣別、匯率、期初持股', () => {
  const csv = `日期,券商,類別,代號,名稱,股數,價格,手續費,金額,稅前股利,預扣稅,稅後股利,再投入,備註,幣別,匯率
2026-10-15,tw,期初持股,006208,富邦台50,50,,,5000,,,,,,,
2026-10-21,tw,買進,2330,台積電,10,1000,20,10020,,,,,,,32.48
2026-10-21,tw,買進,AAPL,Apple,3,200.00,,,,,,,,USD,
`;
  const b = importText(csv, 'tw.csv');
  it('期初持股記成 OPEN（成本在金額欄），台股代號自動判斷幣別，匯率欄有值才記', () => {
    expect(b.warnings).toEqual([]);
    expect(b.txns[0]).toMatchObject({ type: 'OPEN', symbol: '006208', qty: 50, amount: -5000 });
    expect(b.txns[1]).toMatchObject({ type: 'BUY', symbol: '2330', amount: -10020, fx: 32.48 });
    expect(b.txns[1].currency).toBeUndefined(); // 空白 → 依代號判斷
    expect(b.txns[2]).toMatchObject({ type: 'BUY', symbol: 'AAPL', currency: 'USD', amount: -600 });
  });
});

describe('同步時合併匯率', () => {
  it('歷史匯率取聯集；目前匯率取日期較新的一份', () => {
    const base = emptyStore();
    const local = structuredClone(base);
    local.fx = { current: { rate: 32.4, date: '2026-10-21', source: 'a', fetchedAt: '2026-10-21T10:00:00Z' }, history: { '2026-10-21': 32.4 } };
    const remote = structuredClone(base);
    remote.fx = { current: { rate: 32.6, date: '2026-10-22', source: 'b', fetchedAt: '2026-10-22T10:00:00Z' }, history: { '2026-10-22': 32.6 } };
    const m = merge3(base, local, remote).fx;
    expect(m.current?.rate).toBe(32.6);
    expect(m.history).toEqual({ '2026-10-21': 32.4, '2026-10-22': 32.6 });
  });
});

describe('匯率抓取', () => {
  afterEach(() => vi.unstubAllGlobals());
  const resp = (body: unknown, ok = true) => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));

  it('第一個來源給出不合理的數字時改用備援', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      return calls.length === 1 ? resp({ date: '2026-10-21', usd: { twd: 0.0308 } }) : resp({ date: '2026-10-21', usd: { twd: 32.4858 } });
    });
    const q = await fetchUsdTwd('2026-10-21');
    expect(q).toMatchObject({ rate: 32.4858, date: '2026-10-21' });
    expect(calls[0]).toContain('cdn.jsdelivr.net');
    expect(calls[1]).toContain('currency-api.pages.dev');
  });

  it('兩個來源都失敗時回傳 null，不丟例外', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await fetchUsdTwd('latest')).toBeNull();
  });
});
