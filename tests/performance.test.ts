import { emptyStore, type Store, type Txn } from '../src/domain/types';
import { betaSource, checks, dailyValues, monthlyBeta, periodStats, SPX, twrIndex, unadjusted, yearlyRows, type History, type PriceSeries } from '../src/engine/performance';
import { handleHistory, parseChart } from '../worker/history';

let seq = 0;
const tx = (p: Partial<Txn> & Pick<Txn, 'broker' | 'date' | 'type' | 'amount'>): Txn =>
  ({ id: `p${seq++}`, source: p.broker === 'tw' ? 'tw-csv' : 'schwab-transactions', ...p }) as Txn;
const series = (pairs: [string, number][], splits: PriceSeries['splits'] = []): PriceSeries => ({ d: pairs.map((p) => p[0]), c: pairs.map((p) => p[1]), splits });

describe('歷史價格', () => {
  it('分割前的收盤還原成當時價格（Yahoo 的收盤已依分割調整）', () => {
    const u = unadjusted(series([['2024-06-07', 120.888], ['2024-06-10', 121.79]], [{ date: '2024-06-10', ratio: 10 }]));
    expect(u.p[0]).toBeCloseTo(1208.88, 2);
    expect(u.p[1]).toBeCloseTo(121.79, 2);
  });

  it('中繼：日期用交易所當地時間（台股月資料不會掉到上個月），分割比例照實回傳', () => {
    const taipeiMidnight = Date.UTC(2021, 9, 31, 16) / 1000; // 2021-11-01 00:00 台北
    const s = parseChart(
      {
        chart: {
          result: [
            {
              meta: { gmtoffset: 28800 },
              timestamp: [taipeiMidnight],
              indicators: { quote: [{ close: [600] }], adjclose: [{ adjclose: [560.5] }] },
              events: { splits: { x: { date: taipeiMidnight, numerator: 4, denominator: 1 } } },
            },
          ],
        },
      },
      true,
    );
    expect(s).toEqual({ d: ['2021-11-01'], c: [600], a: [560.5], splits: [{ date: '2021-11-01', ratio: 4 }] });
  });

  it('中繼：只接受 GET、合格的 interval 與日期，一次最多 8 檔', async () => {
    const never = () => Promise.reject(new Error('不該呼叫'));
    const st = async (q: string, method = 'GET') => (await handleHistory(new Request(`http://x/api/history?${q}`, { method }), never)).status;
    expect(await st('symbols=AAPL&interval=1d&from=2024-01-01', 'POST')).toBe(405);
    expect(await st('symbols=AAPL&interval=1h&from=2024-01-01')).toBe(400);
    expect(await st('symbols=AAPL&interval=1d&from=yesterday')).toBe(400);
    expect(await st('symbols=A,B,C,D,E,F,G,H,I&interval=1d&from=2024-01-01')).toBe(400);
  });
});

describe('每日總值重建', () => {
  // 錨點快照 2024-03-04：AAA 10 股、現金 100。之前 3/1 入金 500、3/4 買進 5 股；之後 3/6 再入金 1000
  function store(): Store {
    const s = emptyStore();
    s.snapshots.push({ id: 'schwab|2024-03-04', broker: 'schwab', date: '2024-03-04', cash: 100, total: 0, source: 't', rows: [{ symbol: 'AAA', name: 'AAA', qty: 10, price: 100, costBasis: 0, marketValue: 0 }] });
    s.valuePoints = [
      { id: 'statement|2024-03-01', date: '2024-03-01', value: 1100, source: 'statement', note: '對帳單' },
      { id: 'balances|2024-03-05', date: '2024-03-05', value: 0, source: 'balances' }, // 帳戶清空後的 0：不比對
    ];
    s.txns = [
      tx({ broker: 'schwab', date: '2024-03-01', type: 'DEPOSIT', amount: 500 }),
      tx({ broker: 'schwab', date: '2024-03-04', type: 'BUY', symbol: 'AAA', qty: 5, price: 100, amount: -500 }),
      tx({ broker: 'schwab', date: '2024-03-06', type: 'DEPOSIT', amount: 1000 }),
    ];
    return s;
  }
  const hist: History = {
    AAA: series([['2024-02-29', 100], ['2024-03-01', 100], ['2024-03-04', 100], ['2024-03-05', 110], ['2024-03-06', 110]]),
    [SPX]: series([['2024-02-29', 5000], ['2024-03-01', 5000], ['2024-03-04', 5000], ['2024-03-05', 5100], ['2024-03-06', 5100]]),
  };

  it('從錨點快照往回推持股與現金，往後照交易紀錄推', () => {
    const pts = dailyValues(store(), hist, '2024-02-29', '2024-03-06');
    const v = Object.fromEntries(pts.map((p) => [p.date, p.value]));
    expect(v['2024-02-29']).toBeCloseTo(5 * 100 + 100, 6); // 5 股 + 現金 100（入金前）
    expect(v['2024-03-01']).toBeCloseTo(5 * 100 + 600, 6);
    expect(v['2024-03-04']).toBeCloseTo(10 * 100 + 100, 6);
    expect(v['2024-03-05']).toBeCloseTo(10 * 110 + 100, 6);
    expect(v['2024-03-06']).toBeCloseTo(10 * 110 + 1100, 6);
    expect(pts.find((p) => p.date === '2024-03-06')!.flow).toBe(1000);
  });

  it('時間加權：入金不算報酬；只有股價漲的那天有報酬', () => {
    const idx = twrIndex(dailyValues(store(), hist, '2024-02-29', '2024-03-06'));
    const r = periodStats(idx, '2024-02-29', '2024-03-06')!;
    expect(r.ret).toBeCloseTo(100 / 1100, 6); // 3/5 那天 1100 → 1200
  });

  it('和對帳單比對時用 Schwab 帳戶的值', () => {
    const s = store();
    const c = checks(s, dailyValues(s, hist, '2024-02-29', '2024-03-06'));
    expect(c).toEqual([{ date: '2024-03-01', ours: 1100, official: 1100, note: '對帳單' }]);
  });
});

describe('期間表現', () => {
  const idx = [
    { date: '2023-12-29', idx: 100 },
    { date: '2024-03-01', idx: 110 },
    { date: '2024-06-03', idx: 90 },
    { date: '2024-12-31', idx: 120 },
    { date: '2025-02-03', idx: 108 },
  ];
  it('報酬、年內最大漲幅（低點到之後高點）、年內最大跌幅（高點到之後低點）', () => {
    const r = periodStats(idx, '2023-12-31', '2024-12-31')!;
    expect(r.ret).toBeCloseTo(0.2, 6);
    expect(r.maxRise).toBeCloseTo(120 / 90 - 1, 6);
    expect(r.maxDrawdown).toBeCloseTo(90 / 110 - 1, 6);
  });
  it('每年一列；第一年從起算日、今年到資料日', () => {
    const rows = yearlyRows(idx, { [SPX]: series(idx.map((x) => [x.date, x.idx])) }, '2024-03-01', '2025-02-03');
    expect(rows.map((r) => [r.year, r.from, r.to])).toEqual([
      [2024, '2024-03-01', '2024-12-31'],
      [2025, '2024-12-31', '2025-02-03'],
    ]);
    expect(rows[0].portfolio!.ret).toBeCloseTo(120 / 110 - 1, 6);
    expect(rows[1].spx!.ret).toBeCloseTo(-0.1, 6);
  });
});

describe('Beta', () => {
  const months = Array.from({ length: 40 }, (_, i) => `${2022 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`);
  const mkt = months.map((_, i) => 1 + 0.03 * Math.sin(i * 1.7));
  const level = (rs: number[]) => rs.reduce<number[]>((a, r, i) => [...a, i ? a[i - 1] * r : 100], []);
  const market: PriceSeries = { d: months, c: level(mkt), a: level(mkt) };

  it('漲跌是市場兩倍的標的 Beta = 2；台股換成美元時匯率不變就不影響', () => {
    const twice = level(mkt.map((r) => 1 + 2 * (r - 1)));
    expect(monthlyBeta({ d: months, c: twice, a: twice }, market)).toBeCloseTo(2, 6);
    const fx: PriceSeries = { d: months, c: months.map(() => 32) };
    expect(monthlyBeta({ d: months, c: twice.map((x) => x * 32), a: twice.map((x) => x * 32) }, market, fx)).toBeCloseTo(2, 6);
  });
  it('資料少於 24 個月不算', () => {
    expect(monthlyBeta({ d: months.slice(0, 20), c: market.c.slice(0, 20) }, market)).toBeUndefined();
  });
  it('有美股 ADR 對應的台股用 ADR 算（2330 → TSM）', () => {
    const s = emptyStore();
    expect(betaSource(s, '2330')).toEqual({ symbol: 'TSM', fx: false });
    expect(betaSource(s, '006208')).toEqual({ symbol: '006208', fx: true });
    expect(betaSource(s, 'AAPL')).toEqual({ symbol: 'AAPL', fx: false });
  });
});
