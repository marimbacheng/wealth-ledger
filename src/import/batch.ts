import type {
  Coverage,
  EstimateSet,
  PositionSnapshot,
  RealizedRecord,
  SecurityMeta,
  Txn,
  ValuePoint,
} from '../domain/types';

export type ImportKind =
  | 'schwab-positions'
  | 'schwab-transactions'
  | 'schwab-income'
  | 'schwab-realized'
  | 'schwab-realized-details'
  | 'schwab-balances'
  | 'tw-transactions'
  | 'tw-positions'
  | 'value-points'
  | 'unknown';

export const KIND_LABEL: Record<ImportKind, string> = {
  'schwab-positions': 'Schwab 持倉',
  'schwab-transactions': 'Schwab 交易紀錄',
  'schwab-income': 'Schwab 投資收益（股利）',
  'schwab-realized': 'Schwab 已實現損益（彙總）',
  'schwab-realized-details': 'Schwab 已實現損益（逐批明細）',
  'schwab-balances': 'Schwab 帳戶餘額',
  'tw-transactions': '永豐交易／股利（範本格式）',
  'tw-positions': '永豐庫存（範本格式）',
  'value-points': '月底總值（範本格式）',
  unknown: '無法辨識',
};

// 匯入器的輸出：尚未指派 id、尚未與既有資料合併
export interface ImportBatch {
  kind: ImportKind;
  file: string;
  txns: Omit<Txn, 'id'>[];
  snapshot?: Omit<PositionSnapshot, 'id'>;
  realized: Omit<RealizedRecord, 'id'>[];
  estimates?: EstimateSet;
  valuePoint?: Omit<ValuePoint, 'id'>;
  valuePoints?: Omit<ValuePoint, 'id'>[];
  coverage?: Coverage;
  securities: Record<string, SecurityMeta>;
  warnings: string[];
}

export function emptyBatch(kind: ImportKind, file: string): ImportBatch {
  return { kind, file, txns: [], realized: [], securities: {}, warnings: [] };
}

const SYMBOL_ALIASES: Record<string, string> = { BRKB: 'BRK.B', BRKA: 'BRK.A' };

// 跨券商統一代號：BRK/B、BRK B、BRK-B → BRK.B
export function normalizeSymbol(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/[/\s-]+/g, '.');
  return SYMBOL_ALIASES[t] ?? t;
}
