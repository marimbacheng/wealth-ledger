import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importText } from '../src/import';
import { parseCsv, parseMoney } from '../src/import/csv';
import { mergeBatch } from '../src/store/merge';
import { hasRealData, loadRealStore, REAL_DIR, realFiles } from './realdata';

// 預期值一律從匯出檔自己的合計列讀出來，不把個人數字寫進程式碼
function rowsOf(match: string): string[][] {
  const f = realFiles().find((x) => x.includes(match))!;
  return parseCsv(readFileSync(join(REAL_DIR, f), 'utf8'));
}

describe.skipIf(!hasRealData)('真實 Schwab 匯出檔', () => {
  it('每個檔案都能辨識', () => {
    const kinds = realFiles().map((f) => importText(readFileSync(join(REAL_DIR, f), 'utf8'), f).kind);
    expect(kinds).not.toContain('unknown');
    expect(new Set(kinds)).toEqual(
      new Set(['schwab-balances', 'schwab-income', 'schwab-positions', 'schwab-realized', 'schwab-realized-details', 'schwab-transactions']),
    );
  });

  it('持倉：檔數、成本合計、市值合計都等於 Schwab 的 Positions Total', () => {
    const rows = rowsOf('Positions');
    const header = rows.find((r) => r[0] === 'Symbol')!;
    const total = rows.find((r) => r[0] === 'Positions Total')!;
    const costIdx = header.findIndex((h) => h.startsWith('Cost Basis'));
    const mvIdx = header.findIndex((h) => h.startsWith('Mkt Val'));
    const holdingRows = rows.slice(rows.indexOf(header) + 1).filter((r) => r[0] !== 'Positions Total' && !r[0].startsWith('Cash'));

    const snap = loadRealStore().snapshots[0];
    expect(snap.rows).toHaveLength(holdingRows.length);
    expect(snap.rows.reduce((a, r) => a + r.costBasis, 0)).toBeCloseTo(parseMoney(total[costIdx])!, 2);
    expect(snap.total).toBeCloseTo(parseMoney(total[mvIdx])!, 1);
  });

  it('已實現：彙總檔與逐批明細合併後不重複，總額等於 Schwab 的 Total 列', () => {
    const rows = rowsOf('GainLoss_Realized_2');
    const header = rows[1];
    const total = rows.find((r) => r[0] === 'Total')!;
    const gainIdx = header.indexOf('Total Gain/Loss ($)');
    const s = loadRealStore();
    expect(s.realized).toHaveLength(rows.length - 3); // 標題、欄名、Total
    expect(s.realized.reduce((a, r) => a + r.gain, 0)).toBeCloseTo(parseMoney(total[gainIdx])!, 2);
  });

  it('重複匯入同一批檔案不會增加任何資料', () => {
    const once = loadRealStore();
    let twice = once;
    for (const f of realFiles()) {
      twice = mergeBatch(twice, importText(readFileSync(join(REAL_DIR, f), 'utf8'), f)).store;
    }
    expect(twice.txns.length).toBe(once.txns.length);
    expect(twice.realized.length).toBe(once.realized.length);
  });

  it('交易紀錄筆數與 CSV 列數一致', () => {
    const s = loadRealStore();
    const n = s.txns.filter((t) => t.source === 'schwab-transactions').length;
    expect(n).toBe(rowsOf('Transactions').length - 1);
  });
});
