import { emptyBatch, type ImportBatch } from './batch';
import { parseCsv } from './csv';
import {
  parseBalances,
  parseInvestmentIncome,
  parsePositions,
  parseRealizedDetails,
  parseRealizedSummary,
  parseTransactions,
} from './schwab';
import { isTwPositionHeader, isTwTxnHeader, isValueHeader, parseTwPositions, parseTwTransactions, parseValuePoints } from './tw';

export { KIND_LABEL, type ImportBatch, type ImportKind } from './batch';

// 依檔案內容（不是檔名）判斷格式
export function importText(text: string, file: string): ImportBatch {
  const rows = parseCsv(text);
  const first = rows[0]?.[0]?.trim() ?? '';
  if (first.startsWith('Positions for account')) return parsePositions(rows, file);
  if (first.startsWith('Balances for account')) return parseBalances(rows, file);
  if (first.startsWith('Investment Income Transactions')) return parseInvestmentIncome(rows, file);
  if (first.startsWith('Realized Gain/Loss - Lot Details')) return parseRealizedDetails(rows, file);
  if (first.startsWith('Realized Gain/Loss')) return parseRealizedSummary(rows, file);
  if (first === 'Date' && rows[0].some((c) => c.trim() === 'Action')) return parseTransactions(rows, file);
  if (rows[0] && isTwTxnHeader(rows[0])) return parseTwTransactions(rows, file);
  if (rows[0] && isTwPositionHeader(rows[0])) return parseTwPositions(rows, file);
  if (rows[0] && isValueHeader(rows[0])) return parseValuePoints(rows, file);
  const b = emptyBatch('unknown', file);
  b.warnings.push('無法辨識的檔案格式');
  return b;
}

// 台灣 Excel 另存的 CSV 常是 Big5；先試 UTF-8，失敗再用 Big5
export function decodeBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('big5').decode(buf);
  }
}
