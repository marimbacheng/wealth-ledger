import { importText } from '../src/import';
import { parseCsv, parseMoney, parseUsDate } from '../src/import/csv';
import { normalizeSymbol } from '../src/import/batch';

// 合成資料（格式照 Schwab 匯出，數字是假的），讓 CI 在沒有真實資料時也能測匯入器
const POSITIONS = `"Positions for account Individual ...999 as of 11:52 AM ET, 2026/10/15"

"Symbol","Description","Qty (Quantity)","Price","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Cost Basis","Cost/Share","Mkt Val (Market Value)","Last Div (Last Dividend)","Div Yld (Dividend Yield)","Reinvest?","Reinvest Capital Gains?","% of Acct (% of Account)","Asset Type",
"AAA","AAA CORP","10.5","100.00","$1.00","1%","$50.00","5%","$1,000.00","$95.24","$1,050.00","0.50","2%","Yes","N/A","70%","Equity",
"BRK/B","BERKSHIRE","2","400.00","$1.00","1%","$100.00","14%","$700.00","$350.00","$800.00","N/A","N/A","Yes","N/A","29%","Equity",
"Cash & Cash Investments","--","--","--","$0","0%","--","--","--","--","$12.34","--","--","--","--","1%","Cash and Money Market",
"Positions Total","","--","--","$2","0%","$150.00","9%","$1,700.00","--","$1,862.34","--","--","--","--","--","--",
`;

const TRANSACTIONS = `"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"10/01/2026","Reinvest Shares","AAA","AAA CORP","0.05","$100.00","","-$5.00"
"10/01/2026","NRA Tax Adj","AAA","AAA CORP","","","","-$2.14"
"10/01/2026","Qual Div Reinvest","AAA","AAA CORP","","","","$7.14"
"09/15/2026","Sell","BBB","BBB INC","3","$50.00","$0.02","$149.98"
"09/10/2026","Buy","AAA","AAA CORP","1","$98.00","","-$98.00"
"09/01/2026","Wire Received","","WIRED FUNDS RECEIVED","","","","$1000.00"
"08/20/2026","Mystery Action","AAA","AAA CORP","","","","$0.00"
`;

const INCOME = `"Investment Income Transactions as of 10/15/2026 11:53:23 ET"
Transaction Date,Account Number,Account Name,Account Type,Security Description,Symbol,Security Type,Transaction Type,Transaction Amount,Income Type,
"11/15/2026","...999","Individual","BROKERAGE","AAA CORP","AAA","Equities","Dividend","5.25","Estimated",
"10/29/2026","...999","Individual","BROKERAGE","Cash & Money Market","NO NUMBER","Cash & Money Market","Interest","0.01","Estimated",
"10/01/2026","...999","Individual","BROKERAGE","AAA CORP","AAA","Equities","Qual Div Reinvest","7.14","Received",
"03/14/2025","...999","Individual","BROKERAGE","CCC REIT","CCC","Equities","Rev Non-Qualified Div","3.10","Received",
`;

const REALIZED = `"Realized Gain/Loss for ...999 for 04/15/2026 to 10/15/2026 as of Thu Oct 15  11:52:54 EDT 2026","","","","","","","","","",""
"Symbol","Name","Closed Date","Quantity","Closing Price","Cost Basis Method","Proceeds","Cost Basis (CB)","Total Gain/Loss ($)","Total Gain/Loss (%)","Long Term (LT) Gain/Loss ($)"
"BBB","BBB INC","09/15/2026","3","$50.00","FIFO","$149.98","$120.00","$29.98","25%","$29.98"
"Total","","","","","","$149.98","$120.00","$29.98","25%","$29.98"
`;

const TW = `日期,券商,類別,代號,名稱,股數,價格,手續費,金額,稅前股利,預扣稅,稅後股利,再投入,備註
2026-11-03,tw,轉入,,,,,,1000,,,,,
2026-11-05,tw,買進,BRK B,,2,410,3,,,,,,
2026-12-15,tw,股利,AAA,,,,,,10.00,3.00,,,
2027-01-10,tw,股利,AAA,,,,,,,,7.00,,
2026-12-01,tw,不明,AAA,,,,,,,,,,
`;

describe('CSV 工具', () => {
  it('解析引號、引號內逗號、尾端逗號', () => {
    expect(parseCsv('"a","b,c",\n"d""e","f",')).toEqual([
      ['a', 'b,c', ''],
      ['d"e', 'f', ''],
    ]);
  });
  it('金額與日期', () => {
    expect(parseMoney('-$1,234.56')).toBe(-1234.56);
    expect(parseMoney('($5.00)')).toBe(-5);
    expect(parseMoney('$-6.30')).toBe(-6.3);
    expect(parseMoney('$1,234-')).toBe(1234); // 數字後面的符號不算負號
    expect(parseMoney('--')).toBeUndefined();
    expect(parseUsDate('10/15/2026 as of 10/14/2026')).toBe('2026-10-15');
    expect(parseUsDate('2026/1/5')).toBe('2026-01-05');
  });
  it('代號統一', () => {
    expect(normalizeSymbol('BRK/B')).toBe('BRK.B');
    expect(normalizeSymbol('brk b')).toBe('BRK.B');
    expect(normalizeSymbol('BRKB')).toBe('BRK.B');
  });
});

describe('Schwab 匯入（合成資料）', () => {
  it('持倉', () => {
    const b = importText(POSITIONS, 'p.csv');
    expect(b.kind).toBe('schwab-positions');
    expect(b.snapshot!.date).toBe('2026-10-15');
    expect(b.snapshot!.rows.map((r) => r.symbol)).toEqual(['AAA', 'BRK.B']);
    expect(b.snapshot!.cash).toBe(12.34);
    expect(b.snapshot!.rows[0]).toMatchObject({ qty: 10.5, costBasis: 1000, lastDiv: 0.5 });
  });

  it('交易紀錄：分類、再投入、未知動作提醒', () => {
    const b = importText(TRANSACTIONS, 't.csv');
    expect(b.kind).toBe('schwab-transactions');
    const types = b.txns.map((t) => t.type);
    expect(types).toEqual(['BUY', 'TAX', 'DIV', 'SELL', 'BUY', 'DEPOSIT', 'OTHER']);
    expect(b.txns[0].drip).toBe(true);
    expect(b.txns[3]).toMatchObject({ qty: 3, fee: 0.02, amount: 149.98 });
    expect(b.warnings.some((w) => w.includes('Mystery Action'))).toBe(true);
    expect(b.coverage).toEqual({ broker: 'schwab', kind: 'transactions', from: '2026-08-20', to: '2026-10-01' });
  });

  it('投資收益：實領成股利、預估另存', () => {
    const b = importText(INCOME, 'i.csv');
    expect(b.txns.map((t) => [t.symbol, t.amount])).toEqual([
      ['AAA', 7.14],
      ['CCC', 3.1],
    ]);
    expect(b.estimates!.rows).toEqual([{ symbol: 'AAA', date: '2026-11-15', amount: 5.25 }]);
    expect(b.coverage!.to).toBe('2026-10-15');
  });

  it('已實現損益：略過 Total 列', () => {
    const b = importText(REALIZED, 'r.csv');
    expect(b.realized).toHaveLength(1);
    expect(b.realized[0]).toMatchObject({ symbol: 'BBB', proceeds: 149.98, costBasis: 120, gain: 29.98 });
    expect(b.coverage).toMatchObject({ from: '2026-04-15', to: '2026-10-15' });
  });
});

// TD Ameritrade 轉入 Schwab 的歷史格式（合成數字）
const TDA = `"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"06/03/2024","Internal Transfer","","TDA TO CS&CO TRANSFER","","","","$2.22"
"06/03/2024","Journaled Shares","","TDA TRAN - CASH MOVEMENT OF OUTGOING ACCOUNT TRANSFER","","","","-$2.22"
"05/13/2024","Journaled Shares","BRK/B","TDA TRAN - TRANSFER OF SECURITY OR OPTION OUT (BRK B)","-3","","",""
"05/13/2024","Internal Transfer","BRKB","BERKSHIRE HATHAWAY CLASS B","3","","",""
"04/03/2024","Cash In Lieu","","TDA TRAN - CASH IN LIEU OF FRACTIONAL SHARES (SOLV)","","","","$9.38"
"04/01/2024","Journaled Shares","SOLV/WI","TDA TRAN - NON-TAXABLE SPIN OFF/LIQUIDATION DISTRIBUTION (SOLV)","2","","",""
"11/17/2025 as of 11/14/2025","Reinvestment Adj","O","REALTY INCOME CORP REIT","0.1594","$56.595","","$9.02"
"10/31/2022","Qual Div Reinvest","","TDA TRAN - QUALIFIED DIVIDEND (JPM)","","","","$1.03"
"10/26/2022","Journaled Shares","","TDA TRAN - W-8 WITHHOLDING (CMCSA)","","","","-$0.25"
"10/26/2022","Qual Div Reinvest","","TDA TRAN - QUALIFIED DIVIDEND (CMCSA)","","","","$0.82"
"09/01/2023","ADR Mgmt Fee","","TDA TRAN - ADR FEE (UL)","","","","-$0.10"
"08/29/2024","NRA Tax Adj","","SCHWAB1 INT 07/30-08/28","","","","-$0.03"
`;

describe('TD Ameritrade 時期的交易紀錄', () => {
  const b = importText(TDA, 'tda.csv');
  const by = (desc: string) => b.txns.find((t) => t.description?.includes(desc))!;

  it('股利、預扣稅、ADR 費用從說明的括號取代號', () => {
    expect(by('QUALIFIED DIVIDEND (JPM)')).toMatchObject({ type: 'DIV', symbol: 'JPM' });
    expect(by('W-8 WITHHOLDING (CMCSA)')).toMatchObject({ type: 'TAX', symbol: 'CMCSA', amount: -0.25 });
    expect(by('ADR FEE (UL)')).toMatchObject({ type: 'FEE', symbol: 'UL' });
  });

  it('券商轉換的證券與現金移轉不算入金或提領', () => {
    expect(by('TRANSFER OF SECURITY')).toMatchObject({ type: 'OTHER', symbol: 'BRK.B' });
    expect(by('BERKSHIRE HATHAWAY')).toMatchObject({ type: 'OTHER', symbol: 'BRK.B', qty: 3 });
    expect(by('TDA TO CS&CO')).toMatchObject({ type: 'TRANSFER_IN', amount: 2.22 });
    expect(by('CASH MOVEMENT')).toMatchObject({ type: 'TRANSFER_OUT', amount: -2.22 });
    expect(b.txns.some((t) => t.type === 'DEPOSIT' || t.type === 'WITHDRAW')).toBe(false);
  });

  it('再投入撤銷、分拆、零股折現、利息預扣都能辨識，不產生未辨識提醒', () => {
    expect(by('REALTY INCOME')).toMatchObject({ type: 'SELL', drip: true, qty: 0.1594 });
    expect(by('SPIN OFF')).toMatchObject({ type: 'OTHER', symbol: 'SOLV.WI' });
    expect(by('CASH IN LIEU')).toMatchObject({ type: 'OTHER', symbol: 'SOLV', amount: 9.38 });
    expect(by('SCHWAB1 INT')).toMatchObject({ type: 'TAX', symbol: undefined });
    expect(b.warnings).toEqual([]);
  });
});

describe('月底總值範本', () => {
  it('匯入成資產快照點，重複匯入不重複', async () => {
    const { mergeBatch } = await import('../src/store/merge');
    const { emptyStore } = await import('../src/domain/types');
    const csv = '日期,帳戶總值,備註\n2024-05-31,"$20,000.00",五月\n2024-06-30,20500,\n壞掉,1,\n';
    const b = importText(csv, 'v.csv');
    expect(b.kind).toBe('value-points');
    expect(b.valuePoints).toEqual([
      { date: '2024-05-31', value: 20000, source: 'statement', note: '五月' },
      { date: '2024-06-30', value: 20500, source: 'statement', note: '對帳單' },
    ]);
    expect(b.warnings).toHaveLength(1);
    const once = mergeBatch(emptyStore(), b);
    expect(once.added).toBe(2);
    const twice = mergeBatch(once.store, b);
    expect(twice.added).toBe(0);
    expect(twice.store.valuePoints).toHaveLength(2);
  });
});

describe('複委託範本', () => {
  it('買進含手續費、股利拆稅前與預扣、只有稅後標記 netOnly、錯列提醒', () => {
    const b = importText(TW, 'tw.csv');
    expect(b.kind).toBe('tw-transactions');
    const buy = b.txns.find((t) => t.type === 'BUY')!;
    expect(buy).toMatchObject({ symbol: 'BRK.B', qty: 2, fee: 3, amount: -823 });
    const div = b.txns.filter((t) => t.type === 'DIV');
    expect(div[0]).toMatchObject({ amount: 10 });
    expect(b.txns.find((t) => t.type === 'TAX')).toMatchObject({ amount: -3 });
    expect(div[1]).toMatchObject({ amount: 7, netOnly: true });
    expect(b.warnings.some((w) => w.includes('第 6 列'))).toBe(true);
  });
});
