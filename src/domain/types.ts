// 帳本的領域模型。所有金額單位為 USD。
//
// 三本帳的關係：
// - 券商帳（broker）：每家券商自己的成本與損益，忠實反映實際交易，用來對帳與報稅。
// - 延續帳（continuous）：把 Schwab 原始成本延續到台灣複委託重新買進的部位，用來看投資歷程與成本殖利率。
// - 總報酬帳：延續帳的未實現 + 已實現 + 股利淨額 − 帳外費用，跨券商合計。

export type Broker = 'schwab' | 'tw';

// 交易與部位的幣別：美股用 USD，台股（數字代號，如 2330、006208）用 TWD
export type Currency = 'USD' | 'TWD';

export type TxnType =
  | 'BUY'
  | 'SELL'
  | 'DIV' // 股利（稅前金額；netOnly 時為稅後金額）
  | 'TAX' // 預扣稅（amount 為負數；退稅為正數）
  | 'INTEREST'
  | 'DEPOSIT' // 外部資金匯入（計入淨投入）
  | 'WITHDRAW' // 資金匯出到外部（計入淨投入）
  | 'TRANSFER_OUT' // 券商間移轉：匯出（不計入淨投入）
  | 'TRANSFER_IN' // 券商間移轉：匯入
  | 'FEE' // 未計入成本的費用（電匯費、股利處理費…）
  | 'OPEN' // 期初持股：開始記帳前就已持有的部位（只有股數與成本，沒有現金流）
  | 'OTHER';

export interface Txn {
  id: string;
  broker: Broker;
  date: string; // YYYY-MM-DD
  type: TxnType;
  symbol?: string;
  description?: string;
  qty?: number; // 股數，恆為正
  price?: number;
  fee?: number; // 交易手續費，恆為正
  amount: number; // 對現金的影響：流入為正、流出為負
  drip?: boolean; // 股利再投入買進
  netOnly?: boolean; // DIV 只知道稅後金額
  rawAction?: string;
  source: string; // schwab-transactions | schwab-income | tw-csv | sinopac-statement | manual
  note?: string;
  currency?: Currency; // 沒填時依代號判斷（數字代號為 TWD）
  fx?: number; // 交易當天匯率（1 美元兌多少台幣），台幣交易才需要
}

export interface PositionRow {
  symbol: string;
  name: string;
  qty: number;
  price: number;
  costBasis: number;
  marketValue: number;
  lastDiv?: number;
  assetType?: string;
}

export interface PositionSnapshot {
  id: string;
  broker: Broker;
  date: string;
  rows: PositionRow[];
  cash: number;
  total: number;
  source: string;
}

export interface RealizedRecord {
  id: string;
  broker: Broker;
  closedDate: string;
  symbol: string;
  name?: string;
  qty: number;
  proceeds: number;
  costBasis: number;
  gain: number;
  source: string;
}

export interface DividendEstimate {
  symbol: string;
  date: string;
  amount: number; // 稅前
}

export interface EstimateSet {
  broker: Broker;
  importedAt: string; // 匯出當天
  rows: DividendEstimate[];
}

export interface ValuePoint {
  id: string;
  date: string;
  value: number;
  source: 'snapshot' | 'balances' | 'statement' | 'manual';
  note?: string;
}

export interface SecurityMeta {
  name?: string;
  sector?: string;
  assetClass?: string;
  dpsOverride?: number; // 使用者手動設定的年化每股股利（稅前）
  withholdingOverride?: number; // 0~1
  currency?: Currency; // 覆寫幣別判斷
}

export interface PriceQuote {
  price: number;
  date: string;
  source: string;
}

// 跨市場對應：Schwab 賣出 from、在永豐買回 to；1 股 from = ratio 股 to（例：1 股 TSM ADR = 5 股 2330）
export interface SymbolMapping {
  from: string;
  to: string;
  ratio: number;
}

export interface MigrationSettings {
  schwabSellFrom: string;
  schwabSellTo: string;
  twBuyFrom: string;
  twBuyTo: string;
  mappings: SymbolMapping[];
}

// 匯率：1 美元兌多少台幣。history 依日期快取，也供交易當天換算
export interface FxState {
  current?: { rate: number; date: string; source: string; fetchedAt?: string };
  history: Record<string, number>;
}

export interface Settings {
  migration: MigrationSettings;
  // 期初累計淨投入（早於已匯入資料的外部入金總額），用來算「現值 − 淨投入」
  openingContribution?: { date: string; amount: number; note?: string };
  defaultWithholding: number;
}

export interface Coverage {
  broker: Broker;
  kind: 'transactions' | 'income' | 'realized';
  from: string;
  to: string;
}

export interface ImportLogEntry {
  at: string;
  file: string;
  kind: string;
  added: number;
  skipped: number;
}

export interface Store {
  version: 1;
  txns: Txn[];
  snapshots: PositionSnapshot[];
  realized: RealizedRecord[];
  estimates: EstimateSet[];
  valuePoints: ValuePoint[];
  securities: Record<string, SecurityMeta>;
  prices: Record<string, PriceQuote>;
  coverage: Coverage[];
  settings: Settings;
  imports: ImportLogEntry[];
  fx: FxState;
}

export function emptyStore(): Store {
  return {
    version: 1,
    txns: [],
    snapshots: [],
    realized: [],
    estimates: [],
    valuePoints: [],
    securities: {},
    prices: {},
    coverage: [],
    settings: {
      migration: {
        schwabSellFrom: '2026-10-16',
        schwabSellTo: '2026-12-31',
        twBuyFrom: '2026-10-16',
        twBuyTo: '2027-01-31',
        mappings: [{ from: 'TSM', to: '2330', ratio: 5 }],
      },
      defaultWithholding: 0.3,
    },
    imports: [],
    fx: { history: {} },
  };
}
