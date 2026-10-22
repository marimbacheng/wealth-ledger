import { emptyStore, type Store, type Txn } from '../src/domain/types';
import { buildDividendEvents } from '../src/engine/dividends';
import { computeLedgers } from '../src/engine/ledger';
import { buildReport } from '../src/engine/report';
import { xirr } from '../src/engine/xirr';
import { mergeTxns } from '../src/store/merge';

let seq = 0;
function tx(p: Partial<Txn> & Pick<Txn, 'broker' | 'date' | 'type' | 'amount'>): Txn {
  return { id: `t${seq++}`, source: p.broker === 'tw' ? 'tw-csv' : 'schwab-transactions', ...p } as Txn;
}

// 遷移情境（合成數字）：Schwab 持有 AAA 10.25 股（原始成本 1000）、BBB 20 股（原始成本 1200）
// AAA 賣出所得 2050（遞延損益 1050），複委託只買回 10 股、成本 2023；BBB 賣 20 股得 1840，買回 21 股、成本 1912
const AAA_DEFERRED = 2050 - 1000;
const AAA_CONT = 2023 - AAA_DEFERRED * (10 / 10.25);
const AAA_FRAC_GAIN = AAA_DEFERRED * (0.25 / 10.25);

function migrationStore(extra: Txn[] = []): Store {
  const s = emptyStore();
  s.snapshots.push({
    id: 'schwab|2026-10-15',
    broker: 'schwab',
    date: '2026-10-15',
    cash: 100,
    total: 0,
    source: 't',
    rows: [
      { symbol: 'AAA', name: 'AAA CORP', qty: 10.25, price: 200, costBasis: 1000, marketValue: 0 },
      { symbol: 'BBB', name: 'BBB INC', qty: 20, price: 90, costBasis: 1200, marketValue: 0 },
    ],
  });
  s.prices = { AAA: { price: 210, date: '2027-03-01', source: 't' }, BBB: { price: 95, date: '2027-03-01', source: 't' } };
  s.txns = [
    tx({ broker: 'schwab', date: '2026-11-02', type: 'SELL', symbol: 'AAA', qty: 10.25, amount: 2050 }),
    tx({ broker: 'schwab', date: '2026-11-02', type: 'SELL', symbol: 'BBB', qty: 20, amount: 1840 }),
    tx({ broker: 'schwab', date: '2026-11-05', type: 'WITHDRAW', amount: -3950 }),
    tx({ broker: 'tw', date: '2026-11-08', type: 'TRANSFER_IN', amount: 3950 }),
    tx({ broker: 'tw', date: '2026-11-10', type: 'BUY', symbol: 'AAA', qty: 10, price: 202, fee: 3, amount: -2023 }),
    tx({ broker: 'tw', date: '2026-11-10', type: 'BUY', symbol: 'BBB', qty: 21, price: 91, fee: 1, amount: -1912 }),
    ...extra,
  ];
  return s;
}

describe('遷移：延續成本', () => {
  it('延續成本 = 複委託實際成本 − 遞延損益（按配對股數比例）', () => {
    const led = computeLedgers(migrationStore(), '2026-12-01');
    expect(led.continuous.AAA.qty).toBeCloseTo(10, 6);
    expect(led.continuous.AAA.cost).toBeCloseTo(AAA_CONT, 2);
    // 等價寫法：原始成本 + (買回成本 − 賣出所得)，按 10/10.25 配對
    expect(led.continuous.AAA.cost).toBeCloseTo(1000 * (10 / 10.25) + (2023 - 2050 * (10 / 10.25)), 2);
    // BBB：賣 20 股遞延 640；買 21 股，其中 1 股是新資金 → 1912 − 640
    expect(led.continuous.BBB.cost).toBeCloseTo(1272, 2);
    // 複委託帳忠實反映實際買進
    expect(led.tw.AAA.cost).toBe(2023);
    expect(led.tw.BBB.cost).toBe(1912);
    expect(led.schwab.AAA).toBeUndefined();
  });

  it('Schwab 帳照實認列已實現；延續帳不認列已配對部分', () => {
    const led = computeLedgers(migrationStore(), '2026-12-01');
    const schwab = led.realized.filter((r) => r.ledger === 'schwab');
    expect(schwab.find((r) => r.symbol === 'AAA')!.gain).toBeCloseTo(AAA_DEFERRED, 2);
    expect(schwab.find((r) => r.symbol === 'BBB')!.gain).toBeCloseTo(640, 2);
    expect(led.realized.filter((r) => r.ledger === 'continuous')).toHaveLength(0);
  });

  it('沒買回的碎股：期限內列為遷移中，期限後在延續帳實現', () => {
    const during = computeLedgers(migrationStore(), '2026-12-01');
    expect(during.pending).toHaveLength(1);
    expect(during.pending[0].qty).toBeCloseTo(0.25, 6);
    expect(during.pending[0].proceeds).toBeCloseTo(2050 * (0.25 / 10.25), 2);

    const after = computeLedgers(migrationStore(), '2027-03-01');
    expect(after.pending).toHaveLength(0);
    const r = after.realized.filter((x) => x.ledger === 'continuous');
    expect(r).toHaveLength(1);
    expect(r[0].gain).toBeCloseTo(AAA_FRAC_GAIN, 2);
  });

  it('先在複委託買、後在 Schwab 賣，延續成本結果相同', () => {
    const s = migrationStore();
    s.txns = s.txns.map((t) => (t.broker === 'tw' && t.type === 'BUY' ? { ...t, date: '2026-10-20' } : t));
    const led = computeLedgers(s, '2026-12-01');
    expect(led.continuous.AAA.cost).toBeCloseTo(AAA_CONT, 2);
    expect(led.continuous.BBB.cost).toBeCloseTo(1272, 2);
  });

  it('遷移期間 Schwab 匯出不算提領；現金推算正確', () => {
    const s = migrationStore();
    s.settings.openingContribution = { date: '2026-10-15', amount: 2000 };
    const r = buildReport(s, '2026-12-01');
    expect(r.totalReturn.netContribution).toBe(2000);
    expect(r.totals.schwabCash).toBeCloseTo(100 + 2050 + 1840 - 3950, 2);
    expect(r.totals.twCash).toBeCloseTo(3950 - 2023 - 1912, 2);
  });

  it('遷移中的碎股損益計入總報酬，不會在買回期限前消失', () => {
    const during = buildReport(migrationStore(), '2026-12-01');
    const after = buildReport(migrationStore(), '2027-03-01');
    expect(during.totalReturn.pendingMigration).toBeCloseTo(AAA_FRAC_GAIN, 2);
    expect(during.totalReturn.realized).toBeCloseTo(0, 6);
    expect(after.totalReturn.pendingMigration).toBe(0);
    expect(after.totalReturn.realized).toBeCloseTo(AAA_FRAC_GAIN, 2);
  });

  it('總報酬拆解：未實現 + 已實現 + 股利淨額', () => {
    const s = migrationStore([
      tx({ broker: 'tw', date: '2026-12-15', type: 'DIV', symbol: 'BBB', amount: 10, rawAction: '股利（稅前）' }),
      tx({ broker: 'tw', date: '2026-12-15', type: 'TAX', symbol: 'BBB', amount: -3 }),
    ]);
    const r = buildReport(s, '2027-03-01');
    const unreal = 10 * 210 - AAA_CONT + (21 * 95 - 1272);
    expect(r.totalReturn.unrealized).toBeCloseTo(unreal, 2);
    expect(r.totalReturn.realized).toBeCloseTo(AAA_FRAC_GAIN, 2);
    expect(r.totalReturn.dividendsNet).toBeCloseTo(7, 2);
    expect(r.dividends.twYtd.count).toBe(0); // 2027 年還沒有複委託股利
    const r2026 = buildReport(s, '2026-12-31');
    expect(r2026.dividends.twYtd.net).toBeCloseTo(7, 2);
    expect(r2026.dividends.twYtd.tax).toBeCloseTo(3, 2);
  });
});

describe('延續帳錨點', () => {
  // 10/15 早上匯出持倉（含 CCC），當天稍晚賣掉 CCC、10/16 匯出部分現金；10/19 再匯出一次持倉
  function anchorStore(extra: Txn[] = [], laterSnapshot = false): Store {
    const s = emptyStore();
    const snap = (date: string, rows: { symbol: string; qty: number; cost: number }[], cash: number) => ({
      id: `schwab|${date}`,
      broker: 'schwab' as const,
      date,
      cash,
      total: 0,
      source: 't',
      rows: rows.map((r) => ({ symbol: r.symbol, name: r.symbol, qty: r.qty, price: 10, costBasis: r.cost, marketValue: 0 })),
    });
    s.snapshots.push(snap('2026-10-15', [{ symbol: 'AAA', qty: 10, cost: 80 }, { symbol: 'CCC', qty: 28, cost: 2800 }], 230));
    s.snapshots.push(snap('2026-10-19', [{ symbol: 'AAA', qty: 10, cost: 80 }], 30));
    if (laterSnapshot) s.snapshots.push(snap('2026-10-25', [], 2000));
    s.prices = { AAA: { price: 10, date: '2026-10-19', source: 't' }, CCC: { price: 100, date: '2026-10-15', source: 't' } };
    s.txns = [
      tx({ broker: 'schwab', date: '2026-10-15', type: 'SELL', symbol: 'CCC', qty: 28, amount: 2815 }),
      tx({ broker: 'schwab', date: '2026-10-16', type: 'WITHDRAW', amount: -3000 }),
      tx({ broker: 'schwab', date: '2026-10-16', type: 'FEE', amount: -15 }),
      ...extra,
    ];
    return s;
  }

  it('還沒有遷移賣出：用最新的持倉快照（不會殘留當天稍晚已賣掉的股票）', () => {
    const led = computeLedgers(anchorStore(), '2026-10-20');
    expect(led.anchor?.date).toBe('2026-10-19');
    expect(Object.keys(led.continuous)).toEqual(['AAA']);
    expect(led.schwabCash).toBeCloseTo(30, 2);
  });

  it('開始遷移賣出後：用第一筆賣出前的最後一份快照；之後匯出的空持倉不影響', () => {
    const sell = tx({ broker: 'schwab', date: '2026-10-21', type: 'SELL', symbol: 'AAA', qty: 10, amount: 100 });
    const led = computeLedgers(anchorStore([sell], true), '2026-10-26');
    expect(led.anchor?.date).toBe('2026-10-19');
    expect(led.pending[0]).toMatchObject({ symbol: 'AAA', qty: 10, originalCost: 80, proceeds: 100 });
  });

  it('快照當天稍晚才賣出：快照仍有全部股數 → 用當天快照，當天的遷移賣出接在快照之後', () => {
    const sell = tx({ broker: 'schwab', date: '2026-10-19', type: 'SELL', symbol: 'AAA', qty: 10, amount: 100 });
    const led = computeLedgers(anchorStore([sell], true), '2026-10-26');
    expect(led.anchor?.date).toBe('2026-10-19');
    expect(led.schwab.AAA?.qty ?? 0).toBeCloseTo(0, 6);
    expect(led.schwabCash).toBeCloseTo(30 + 100, 2);
    expect(led.pending[0]).toMatchObject({ symbol: 'AAA', qty: 10, originalCost: 80, proceeds: 100 });
    expect(led.continuous.CCC).toBeUndefined();
    // Schwab 已實現報表裡的這筆遷移賣出，延續帳不能再算一次已實現（損益已遞延到買回成本）
    const s = anchorStore([sell], true);
    s.realized.push({ id: 'r1', broker: 'schwab', symbol: 'AAA', qty: 10, closedDate: '2026-10-19', proceeds: 100, costBasis: 80, gain: 20, source: 't' });
    const r = buildReport(s, '2026-10-26');
    expect(r.realized.continuous).toBeCloseTo(0, 6);
    expect(r.realized.schwabReported).toBeCloseTo(20, 6);
    expect(r.totalReturn.pendingMigration).toBeCloseTo(20, 6);
  });

  it('當天快照已經反映賣出（股數不足）→ 不能當錨點，改用前一份', () => {
    const s = anchorStore([tx({ broker: 'schwab', date: '2026-10-19', type: 'SELL', symbol: 'AAA', qty: 10, amount: 100 })]);
    s.snapshots = s.snapshots.map((x) => (x.date === '2026-10-19' ? { ...x, rows: [] } : x));
    expect(computeLedgers(s, '2026-10-26').anchor?.date).toBe('2026-10-15');
  });

  it('Schwab 現金推算為負時提醒重新匯出', () => {
    const s = anchorStore();
    s.snapshots = s.snapshots.filter((x) => x.date === '2026-10-15');
    s.txns.push(tx({ broker: 'schwab', date: '2026-10-17', type: 'WITHDRAW', amount: -500 }));
    const r = buildReport(s, '2026-10-20');
    expect(r.warnings.some((w) => w.includes('Schwab 現金推算為'))).toBe(true);
  });
});

describe('股利', () => {
  // 合成數字：DDD 有 30% 預扣、GGG 不預扣、EEE 從沒觀察過預扣、FFF 只有實收淨額
  function divStore(): Store {
    const s = emptyStore();
    s.coverage.push({ broker: 'schwab', kind: 'transactions', from: '2026-04-15', to: '2026-10-15' });
    s.txns = [
      // 交易紀錄期間內：股利 + NRA 預扣
      tx({ broker: 'schwab', date: '2026-07-01', type: 'DIV', symbol: 'DDD', amount: 10, rawAction: 'Qual Div Reinvest' }),
      tx({ broker: 'schwab', date: '2026-07-01', type: 'TAX', symbol: 'DDD', amount: -3, rawAction: 'NRA Tax Adj' }),
      tx({ broker: 'schwab', date: '2026-09-25', type: 'DIV', symbol: 'GGG', amount: 6, rawAction: 'Qual Div Reinvest' }),
      // 投資收益檔：同一筆（應去重）與更早的一筆（應估稅）
      tx({ broker: 'schwab', date: '2026-07-01', type: 'DIV', symbol: 'DDD', amount: 10, source: 'schwab-income', rawAction: 'Qual Div Reinvest' }),
      tx({ broker: 'schwab', date: '2025-04-01', type: 'DIV', symbol: 'DDD', amount: 8, source: 'schwab-income', rawAction: 'Qual Div Reinvest' }),
      tx({ broker: 'schwab', date: '2025-03-27', type: 'DIV', symbol: 'GGG', amount: 5, source: 'schwab-income', rawAction: 'Qual Div Reinvest' }),
      tx({ broker: 'schwab', date: '2025-03-14', type: 'DIV', symbol: 'EEE', amount: 4, source: 'schwab-income', rawAction: 'Reinvest Dividend' }),
      // 只有稅後
      tx({ broker: 'tw', date: '2026-12-01', type: 'DIV', symbol: 'FFF', amount: 15, netOnly: true }),
    ];
    return s;
  }

  it('投資收益檔用 CUSIP 時，用金額與日期配對，不會重複計算', () => {
    const s = divStore();
    s.txns.push(
      tx({ broker: 'schwab', date: '2025-06-13', type: 'DIV', symbol: 'UL', amount: 9.8, rawAction: 'Qualified Dividend' }),
      tx({ broker: 'schwab', date: '2025-06-13', type: 'DIV', symbol: '904767704', amount: 9.8, source: 'schwab-income', rawAction: 'Qualified Dividend' }),
    );
    s.coverage.push({ broker: 'schwab', kind: 'transactions', from: '2022-10-20', to: '2026-10-16' });
    const ev = buildDividendEvents(s).filter((e) => e.date === '2025-06-13');
    expect(ev.map((e) => e.symbol)).toEqual(['UL']);
  });

  it('交易紀錄與投資收益檔重複的股利只算一次', () => {
    const ev = buildDividendEvents(divStore());
    expect(ev.filter((e) => e.symbol === 'DDD' && e.date === '2026-07-01')).toHaveLength(1);
  });

  it('預扣稅配到同日股利；涵蓋期間內無預扣即為實際 0', () => {
    const ev = buildDividendEvents(divStore());
    const d = ev.find((e) => e.symbol === 'DDD' && e.date === '2026-07-01')!;
    expect(d).toMatchObject({ gross: 10, tax: 3, taxStatus: 'actual', reinvested: true });
    expect(d.net).toBeCloseTo(7, 2);
    const g = ev.find((e) => e.symbol === 'GGG' && e.date === '2026-09-25')!;
    expect(g).toMatchObject({ tax: 0, taxStatus: 'actual' });
  });

  it('涵蓋期間外只有稅前：用觀察到的稅率估算，沒觀察過用預設 30%', () => {
    const ev = buildDividendEvents(divStore());
    const d = ev.find((e) => e.symbol === 'DDD' && e.date === '2025-04-01')!;
    expect(d.taxStatus).toBe('estimated');
    expect(d.tax).toBeCloseTo(8 * 0.3, 2);
    expect(ev.find((e) => e.symbol === 'GGG' && e.date === '2025-03-27')!.tax).toBe(0);
    expect(ev.find((e) => e.symbol === 'EEE')!.tax).toBeCloseTo(1.2, 2);
  });

  it('動作名稱沒寫再投入，但同期有再投入買進 → 標記為再投入', () => {
    const s = divStore();
    s.txns.push(
      tx({ broker: 'schwab', date: '2026-07-15', type: 'DIV', symbol: 'OOO', amount: 8, rawAction: 'Non-Qualified Div' }),
      tx({ broker: 'schwab', date: '2026-07-15', type: 'BUY', symbol: 'OOO', qty: 0.1, amount: -5.6, drip: true, rawAction: 'Reinvest Shares' }),
      tx({ broker: 'schwab', date: '2026-08-14', type: 'DIV', symbol: 'OOO', amount: 8, rawAction: 'Non-Qualified Div' }),
      tx({ broker: 'schwab', date: '2025-03-14', type: 'DIV', symbol: 'OOO', amount: 7, source: 'schwab-income', rawAction: 'Rev Non-Qualified Div' }),
    );
    const ev = buildDividendEvents(s).filter((e) => e.symbol === 'OOO');
    expect(ev.map((e) => [e.date, e.reinvested])).toEqual([
      ['2025-03-14', true],
      ['2026-07-15', true],
      ['2026-08-14', false],
    ]);
  });

  it('只有稅後金額的股利標記 netOnly，不計入稅前合計', () => {
    const ev = buildDividendEvents(divStore());
    const f = ev.find((e) => e.symbol === 'FFF')!;
    expect(f).toMatchObject({ taxStatus: 'netOnly', net: 15, gross: undefined });
  });
});

describe('匯入去重', () => {
  it('同檔重複匯入不增加；同日兩筆相同真實交易都保留', () => {
    const a = { broker: 'schwab' as const, date: '2026-05-07', type: 'BUY' as const, symbol: 'AAA', qty: 1, price: 50, amount: -50, source: 'schwab-transactions' };
    const first = mergeTxns([], [a, a]);
    expect(first.added).toBe(2);
    const again = mergeTxns(first.txns, [a, a]);
    expect(again.added).toBe(0);
    expect(again.txns).toHaveLength(2);
  });
});

describe('XIRR', () => {
  it('一年 10%', () => {
    expect(xirr([{ date: '2021-01-01', amount: -1000 }, { date: '2022-01-01', amount: 1100 }])).toBeCloseTo(0.1, 6);
  });
  it('沒有正負現金流時回傳 undefined', () => {
    expect(xirr([{ date: '2021-01-01', amount: -1000 }])).toBeUndefined();
  });
});
