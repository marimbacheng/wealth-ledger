import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyStore, type Store } from '../src/domain/types';
import { buildReport } from '../src/engine/report';
import { importText } from '../src/import';
import { parseCsv, parseMoney, parseUsDate } from '../src/import/csv';
import { mergeBatch } from '../src/store/merge';

// 完整歷史（含 TD Ameritrade 轉入的紀錄）的回歸測試。預期值一律從匯出檔本身算出，不寫死個人數字。
const ROOT = join(__dirname, '..');
const DIRS = ['20261015 Schwab 資料', '20261019 Schwab 匯出'].map((d) => join(ROOT, d));
const has = DIRS.every(existsSync);
const files = (dir: string) => readdirSync(dir).filter((f) => /\.csv$/i.test(f)).sort();
const latest = (re: RegExp) => DIRS.flatMap((d) => files(d).filter((f) => re.test(f)).map((f) => join(d, f))).sort().pop()!;

describe.skipIf(!has)('完整 Schwab 歷史', () => {
  let store: Store = emptyStore();
  const warnings: string[] = [];
  beforeAll(() => {
    for (const d of DIRS)
      for (const f of files(d)) {
        const b = importText(readFileSync(join(d, f), 'utf8'), f);
        warnings.push(...b.warnings);
        store = mergeBatch(store, b).store;
      }
  });

  it('所有列都能辨識', () => {
    expect(warnings).toEqual([]);
  });

  it('每年稅前股利 = 投資收益檔的實領合計（兩個來源不重複計算，含 CUSIP 代號）', () => {
    const rows = parseCsv(readFileSync(latest(/InvestmentIncome/), 'utf8')).filter((r) => r[9] === 'Received' && !/interest/i.test(r[7]));
    const r = buildReport(store, '2026-12-31');
    for (const y of [2025, 2026]) {
      const expected = rows.filter((x) => parseUsDate(x[0])!.startsWith(String(y))).reduce((a, x) => a + Number(x[8]), 0);
      const got = r.dividends.byYear.find((b) => b.year === y)!.totals;
      expect(got.gross).toBeCloseTo(expected, 2);
      expect(got.estimatedCount).toBe(0);
    }
  });

  it('延續帳起點是最新持倉：檔數、成本、現金都等於 Schwab 的匯出', () => {
    const pos = parseCsv(readFileSync(latest(/Positions/), 'utf8'));
    const header = pos.find((r) => r[0] === 'Symbol')!;
    const total = pos.find((r) => r[0] === 'Positions Total')!;
    const n = pos.slice(pos.indexOf(header) + 1).filter((r) => r[0] && r[0] !== 'Positions Total' && !r[0].startsWith('Cash')).length;
    const bal = parseCsv(readFileSync(latest(/Balances/), 'utf8'));
    const cash = parseMoney(bal.find((r) => r[0] === 'Cash Balance')![1])!;
    const r = buildReport(store, '2026-10-20');
    expect(r.holdings).toHaveLength(n);
    expect(r.totals.brokerCost).toBeCloseTo(parseMoney(total[header.findIndex((h) => h.startsWith('Cost Basis'))])!, 2);
    expect(r.totals.schwabCash).toBeCloseTo(cash, 2);
  });

  it('每一筆賣出都有對應的已實現損益', () => {
    const sells = store.txns.filter((t) => t.broker === 'schwab' && t.type === 'SELL' && !t.drip).map((t) => `${t.date}|${t.symbol}`);
    const realized = new Set(store.realized.map((x) => `${x.closedDate}|${x.symbol}`));
    expect(sells.filter((k) => !realized.has(k))).toEqual([]);
  });
});
