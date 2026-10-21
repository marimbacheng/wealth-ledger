import type { SecurityMeta } from './types';

// 內建產業分類（GICS 大類，中文）；不在清單上的代號顯示「未分類」，使用者可在設定頁覆寫。
const SECTORS: Record<string, string> = {
  資訊科技: 'AAPL MSFT NVDA TSM AVGO ORCL CSCO TXN QCOM INTC AMD ADBE CRM ACN IBM ASML',
  通訊服務: 'GOOGL GOOG META NFLX DIS CMCSA T VZ TMUS',
  醫療保健: 'JNJ ABBV PFE MRK LLY UNH AMGN ABT TMO MDT ZTS BMY CVS GILD',
  金融: 'BRK.B JPM BAC WFC V MA BLK GS MS SCHW TROW CB AXP',
  必需消費: 'KO PEP PG COST WMT MO PM CL KMB MDLZ GIS HSY NSRGY UL KHC',
  非必需消費: 'AMZN TSLA HD LOW MCD SBUX NKE TGT TJX BKNG GRMN',
  工業: 'CAT HON UNP UPS LMT RTX GE DE MMM ITW ADP CSL SNA',
  能源: 'XOM CVX COP',
  公用事業: 'NEE DUK SO D',
  原物料: 'LIN APD SHW',
  不動產: 'O ADC PLD AMT VICI SPG ONL',
};
const ETF: Record<string, string> = {
  VOO: 'ETF：美股大盤',
  SPY: 'ETF：美股大盤',
  IVV: 'ETF：美股大盤',
  VTI: 'ETF：美股大盤',
  QQQ: 'ETF：美股大盤',
  VT: 'ETF：全球',
  VXUS: 'ETF：全球',
  SCHD: 'ETF：美股高股息',
  VYM: 'ETF：美股高股息',
  HDV: 'ETF：美股高股息',
  DGRO: 'ETF：美股高股息',
  VIG: 'ETF：美股高股息',
  JEPI: 'ETF：美股高股息',
  VNQ: 'ETF：不動產',
};
// 台股（數字代號）
const TW_STOCK: Record<string, [string, string]> = {
  '2330': ['台積電', '資訊科技'],
  '2317': ['鴻海', '資訊科技'],
  '2454': ['聯發科', '資訊科技'],
  '2881': ['富邦金', '金融'],
  '2882': ['國泰金', '金融'],
};
const TW_ETF: Record<string, [string, string]> = {
  '0050': ['元大台灣50', 'ETF：台股大盤'],
  '006208': ['富邦台50', 'ETF：台股大盤'],
  '0056': ['元大高股息', 'ETF：台股高股息'],
  '00878': ['國泰永續高股息', 'ETF：台股高股息'],
  '00713': ['元大台灣高息低波', 'ETF：台股高股息'],
};
const BOND_ETF: Record<string, string> = {
  SGOV: 'ETF：短期美債',
  BIL: 'ETF：短期美債',
  SHV: 'ETF：短期美債',
  TLT: 'ETF：長期美債',
  BND: 'ETF：綜合債券',
  AGG: 'ETF：綜合債券',
};

export const DEFAULT_META: Record<string, Required<Pick<SecurityMeta, 'sector' | 'assetClass'>>> = {};
for (const [sector, list] of Object.entries(SECTORS)) {
  for (const sym of list.split(' ')) DEFAULT_META[sym] = { sector, assetClass: '個股' };
}
for (const [sym, sector] of Object.entries(ETF)) DEFAULT_META[sym] = { sector, assetClass: 'ETF' };
for (const [sym, sector] of Object.entries(BOND_ETF)) DEFAULT_META[sym] = { sector, assetClass: '債券 ETF' };
for (const [sym, [, sector]] of Object.entries(TW_STOCK)) DEFAULT_META[sym] = { sector, assetClass: '台股' };
for (const [sym, [, sector]] of Object.entries(TW_ETF)) DEFAULT_META[sym] = { sector, assetClass: '台股 ETF' };
export const DEFAULT_NAMES: Record<string, string> = Object.fromEntries([...Object.entries(TW_STOCK), ...Object.entries(TW_ETF)].map(([k, [n]]) => [k, n]));

export function metaFor(symbol: string, user: Record<string, SecurityMeta>): SecurityMeta & { sector: string; assetClass: string } {
  const d = DEFAULT_META[symbol];
  const u = user[symbol] ?? {};
  return {
    ...u,
    name: u.name || DEFAULT_NAMES[symbol],
    sector: u.sector || d?.sector || '未分類',
    assetClass: u.assetClass || d?.assetClass || '未分類',
  };
}
