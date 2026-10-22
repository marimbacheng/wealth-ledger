import { marketOpen } from '../src/quotes/market';
import { applyQuotes, PERSIST_MS, shouldPersist, validQuotes } from '../src/quotes/quotes';
import { getQuotes, handleQuotes, parseYahoo, rocDate, yahooSymbol } from '../worker/quotes';

// 合成的上游回應：格式照證交所、櫃買中心 OpenAPI 與 Yahoo chart 的實際欄位
const TWSE = [
  { Date: '1151021', Code: '2330', Name: '台積電', ClosingPrice: '2,420.00', Change: '15.0000' },
  { Date: '1151021', Code: '0050', Name: '元大台灣50', ClosingPrice: '--' },
];
// 證交所即時行情：收盤集合競價時沒有成交價（z 為 "-"）
const MIS_AUCTION = { msgArray: [{ c: '2330', z: '-', y: '2420.0000', d: '20261022', t: '13:28:09' }], rtcode: '0000' };
const MIS_TRADING = { msgArray: [{ c: '2330', z: '2395.0000', y: '2420.0000', d: '20261022', t: '11:05:30' }, { c: '006208', z: '245.10', d: '20261022', t: '11:05:30' }], rtcode: '0000' };
const TPEX = [{ Date: '1151021', SecuritiesCompanyCode: '00679B', CompanyName: '元大美債20年', Close: '25.77', Change: '-0.02 ' }];
const yahoo = (price: number, epoch: number, tz = 'America/New_York', prev?: number) => ({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: epoch, exchangeTimezoneName: tz, chartPreviousClose: prev } }] } });
// 2026-10-21 16:00 美東 = 2026-10-22 04:00 台灣：日期要算成美國的 10/21
const CLOSE_1021_ET = Date.UTC(2026, 9, 21, 20, 0) / 1000;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function upstream(overrides: Partial<Record<'mis' | 'twse' | 'tpex' | 'yahoo', () => Promise<Response>>> = {}) {
  const calls: string[] = [];
  const fn = (url: string) => {
    calls.push(url);
    if (url.includes('mis.twse')) return overrides.mis?.() ?? json(MIS_AUCTION);
    if (url.includes('openapi.twse')) return overrides.twse?.() ?? json(TWSE);
    if (url.includes('tpex')) return overrides.tpex?.() ?? json(TPEX);
    if (url.includes('/BRK-B?')) return overrides.yahoo?.() ?? json(yahoo(538.99, CLOSE_1021_ET));
    if (url.includes('/AAPL?')) return overrides.yahoo?.() ?? json(yahoo(343.99, CLOSE_1021_ET, 'America/New_York', 339.5));
    if (url.includes('/00679B.TWO?')) return json(yahoo(26, Date.UTC(2026, 9, 22, 5, 0) / 1000, 'Asia/Taipei'));
    return json({ chart: { result: null, error: { code: 'Not Found' } } }, 404);
  };
  return { fn, calls };
}

describe('報價中繼', () => {
  it('民國日期、Yahoo 代號、交易所當地日期', () => {
    expect(rocDate('1151021')).toBe('2026-10-21');
    expect(rocDate('991231')).toBe('2010-12-31');
    expect(yahooSymbol('BRK.B')).toBe('BRK-B');
    expect(parseYahoo(yahoo(340.1, CLOSE_1021_ET))).toMatchObject({ price: 340.1, date: '2026-10-21', source: 'Yahoo' });
    expect(parseYahoo({ chart: { result: [] } })).toBeUndefined();
  });

  it('台股先查證交所，查不到再查櫃買中心；美股查 Yahoo；當日沒成交的不給價格', async () => {
    const { fn, calls } = upstream();
    const r = await getQuotes(['AAPL', 'BRK.B'], ['2330', '00679B', '0050', '9999'], fn);
    // 前一日收盤 = 收盤 − 漲跌（下跌時漲跌為負）
    expect(r.quotes['2330']).toEqual({ price: 2420, date: '2026-10-21', source: '證交所', prevClose: 2405 });
    expect(r.quotes['00679B']).toEqual({ price: 25.77, date: '2026-10-21', source: '櫃買中心', prevClose: 25.79 });
    expect(r.quotes.AAPL).toMatchObject({ price: 343.99, date: '2026-10-21', source: 'Yahoo', prevClose: 339.5 });
    expect(r.quotes['BRK.B']?.price).toBe(538.99);
    expect(r.quotes['0050']).toBeUndefined();
    expect(r.errors['0050']).toContain('沒有成交價');
    expect(r.errors['9999']).toContain('查不到');
    expect(calls.filter((u) => u.includes('openapi.twse'))).toHaveLength(1);
    expect(calls.some((u) => u.includes('BRK-B'))).toBe(true);
  });

  it('盤中用證交所即時成交價；即時行情都有價格時不再查每日收盤', async () => {
    const { fn, calls } = upstream({ mis: () => json(MIS_TRADING) });
    const r = await getQuotes([], ['2330', '006208'], fn);
    expect(r.quotes['2330']).toEqual({ price: 2395, date: '2026-10-22', source: '證交所即時', time: '2026-10-22T03:05:30.000Z', prevClose: 2420 });
    expect(r.quotes['006208']?.price).toBe(245.1);
    expect(calls.some((u) => u.includes('openapi.twse'))).toBe(false);
    expect(calls.find((u) => u.includes('mis.twse'))).toContain('tse_2330.tw|otc_2330.tw');
  });

  it('即時行情連不上（例如擋掉 Cloudflare）時，照樣用每日收盤', async () => {
    const { fn } = upstream({ mis: () => Promise.reject(new TypeError('blocked')) });
    const r = await getQuotes([], ['2330'], fn);
    expect(r.quotes['2330']).toEqual({ price: 2420, date: '2026-10-21', source: '證交所', prevClose: 2405 });
  });

  it('櫃買中心擋掉時（Cloudflare 實測會被擋），台股改查 Yahoo 的 .TW／.TWO', async () => {
    const { fn, calls } = upstream({ tpex: () => Promise.reject(new TypeError('Too many redirects')) });
    const r = await getQuotes([], ['2330', '00679B', '9999'], fn);
    expect(r.quotes['2330']?.source).toBe('證交所');
    expect(r.quotes['00679B']).toMatchObject({ price: 26, date: '2026-10-22', source: 'Yahoo' });
    expect(r.errors['00679B']).toBeUndefined();
    expect(r.errors['9999']).toBeDefined();
    expect(calls.some((u) => u.includes('/2330.TW'))).toBe(false); // 官方有的就不再查 Yahoo
  });

  it('上游失敗只影響那幾檔，不會整批失敗', async () => {
    const { fn } = upstream({ twse: () => json({}, 503), yahoo: () => Promise.reject(new TypeError('blocked')) });
    const r = await getQuotes(['AAPL'], ['2330', '00679B'], fn);
    expect(r.quotes['00679B']?.price).toBe(25.77);
    expect(r.errors['2330']).toBeDefined();
    expect(r.errors.AAPL).toContain('Yahoo');
  });

  it('只接受 GET、代號要合格、數量有上限；不合格的代號不送到上游', async () => {
    const { fn, calls } = upstream();
    expect((await handleQuotes(new Request('http://x/api/quotes?us=AAPL', { method: 'POST' }), fn)).status).toBe(405);
    expect((await handleQuotes(new Request('http://x/api/quotes'), fn)).status).toBe(400);
    const many = Array.from({ length: 61 }, (_, i) => `A${i}`).join(',');
    expect((await handleQuotes(new Request(`http://x/api/quotes?us=${many}`), fn)).status).toBe(400);
    const r = await handleQuotes(new Request('http://x/api/quotes?us=aapl,../../etc&tw=2330'), fn);
    const body = (await r.json()) as { quotes: Record<string, unknown>; errors: Record<string, string> };
    expect(Object.keys(body.quotes).sort()).toEqual(['2330', 'AAPL']);
    expect(body.errors['../../ETC']).toBe('代號格式不正確');
    expect(calls.every((u) => !u.includes('etc'))).toBe(true);
  });
});

describe('前端套用報價', () => {
  it('回應先驗證：價格不是正數或日期格式不對的丟掉', () => {
    const v = validQuotes({ quotes: { A: { price: 1, date: '2026-10-21', source: 'Yahoo' }, B: { price: -1, date: '2026-10-21', source: 'x' }, C: { price: 2, date: '10/21', source: 'x' } }, errors: { D: 'x' } });
    expect(Object.keys(v!.quotes)).toEqual(['A']);
    expect(v!.errors).toEqual({ D: 'x' });
    expect(validQuotes('nope')).toBeNull();
  });

  it('較新的日期才取代；同一天不蓋掉手動輸入；較舊的報價不取代較新的價格', () => {
    const prices = {
      A: { price: 10, date: '2026-10-20', source: '永豐 持倉' },
      B: { price: 20, date: '2026-10-21', source: '手動' },
      C: { price: 30, date: '2026-10-23', source: '手動' },
      D: { price: 40, date: '2026-10-21', source: 'Yahoo' },
    };
    const { prices: next, updated } = applyQuotes(prices, {
      A: { price: 11, date: '2026-10-21', source: 'Yahoo' },
      B: { price: 21, date: '2026-10-21', source: 'Yahoo' },
      C: { price: 31, date: '2026-10-21', source: 'Yahoo' },
      D: { price: 41, date: '2026-10-21', source: 'Yahoo' },
      E: { price: 50, date: '2026-10-21', source: '證交所' },
    });
    expect(updated.sort()).toEqual(['A', 'D', 'E']);
    expect(next.A).toEqual({ price: 11, date: '2026-10-21', source: 'Yahoo' });
    expect(next.B.price).toBe(20);
    expect(next.C.price).toBe(30);
    expect(next.D.price).toBe(41);
  });
});

describe('盤中更新', () => {
  it('交易時段：台股 09:00–13:35 台北、美股 09:30–16:05 紐約，週末不算', () => {
    const at = (iso: string) => marketOpen(new Date(iso));
    expect(at('2026-10-22T01:30:00Z')).toBe(true); // 台北 09:30（週四）
    expect(at('2026-10-22T06:00:00Z')).toBe(false); // 台北 14:00、紐約 02:00
    expect(at('2026-10-22T14:00:00Z')).toBe(true); // 紐約 10:00
    expect(at('2026-10-22T20:30:00Z')).toBe(false); // 紐約 16:30
    expect(at('2026-10-24T02:00:00Z')).toBe(false); // 週六
  });

  it('寫進帳本（會同步）只在手動更新、新交易日、或距上次超過 30 分鐘', () => {
    const prices = { A: { price: 10, date: '2026-10-22', source: 'Yahoo' } };
    const q = { A: { price: 10.5, date: '2026-10-22', source: 'Yahoo' } };
    const t0 = Date.parse('2026-10-22T02:00:00Z');
    expect(shouldPersist(prices, q, t0, t0 + 60_000, false)).toBe(false);
    expect(shouldPersist(prices, q, t0, t0 + 60_000, true)).toBe(true);
    expect(shouldPersist(prices, q, t0, t0 + PERSIST_MS, false)).toBe(true);
    expect(shouldPersist(prices, { A: { ...q.A, date: '2026-10-23' } }, t0, t0 + 60_000, false)).toBe(true);
    expect(shouldPersist(prices, { B: q.A }, t0, t0 + 60_000, false)).toBe(true);
  });
});
