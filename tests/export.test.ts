import { emptyStore } from '../src/domain/types';
import { buildReport } from '../src/engine/report';
import { EXPORT_FIELDS, exportFields, holdingsCsv, holdingsMarkdown } from '../src/ui/exportHoldings';

function report() {
  const s = emptyStore();
  s.snapshots.push({
    id: 'schwab|2026-10-15',
    broker: 'schwab',
    date: '2026-10-15',
    cash: 0,
    total: 0,
    source: 't',
    rows: [
      { symbol: 'AAA', name: 'AAA, "Inc"', qty: 10, price: 50, costBasis: 400, marketValue: 500 },
      { symbol: 'BBB', name: 'BBB | Corp', qty: 2, price: 100, costBasis: 250, marketValue: 200 },
    ],
  });
  s.securities = { AAA: { name: 'AAA, "Inc"' }, BBB: { name: 'BBB | Corp' } };
  s.prices = { AAA: { price: 50, date: '2026-10-15', source: 't' }, BBB: { price: 100, date: '2026-10-15', source: 't' } };
  return buildReport(s, '2026-10-19');
}

describe('持股明細匯出', () => {
  it('CSV：表頭、每檔一列、含逗號與引號的名稱正確跳脫', () => {
    const r = report();
    const csv = holdingsCsv(r.holdings);
    const lines = csv.replace(/^﻿/, '').trim().split('\n');
    expect(lines).toHaveLength(1 + 2);
    expect(lines[0].split(',')).toHaveLength(EXPORT_FIELDS.length);
    expect(csv).toContain('"AAA, ""Inc"""');
    // 依市值排序：AAA 在前；Schwab 成本 400、永豐 0、券商成本 400
    expect(lines[1]).toMatch(/^AAA,/);
    expect(lines[1]).toContain(',400,0,400,');
  });

  it('Markdown：合計、欄位說明、表格列數，名稱中的 | 會跳脫', () => {
    const r = report();
    const md = holdingsMarkdown(r, r.holdings);
    expect(md).toContain('# 持股明細（資料日 2026-10-19');
    expect(md).toContain('券商成本（Schwab 650 ＋ 永豐 0）650');
    expect(md).toContain('- 延續成本：從第一次買進算起的成本');
    expect(md).toContain('BBB \\| Corp');
    const tableRows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---'));
    expect(tableRows).toHaveLength(1 + 2);
  });

  it('Schwab 已沒有持股：只留永豐成本與延續成本，不列 Schwab 成本', () => {
    const r = report();
    const rows = r.holdings.map((h) => ({ ...h, schwabQty: 0, twQty: h.qty }));
    const header = holdingsCsv(rows).replace(/^\uFEFF/, '').split('\n')[0];
    expect(header).not.toContain('Schwab成本');
    expect(header).not.toContain('券商成本');
    expect(header).toContain('永豐成本(USD)');
    expect(header.split(',')).toHaveLength(exportFields(false).length);
    const md = holdingsMarkdown({ ...r, holdings: rows }, rows);
    expect(md).toContain('- 永豐成本 650 USD');
    expect(md).toContain('延續成本 − 永豐成本 = −（移轉時 Schwab 賣出所得 − 原始成本）');
  });
});

