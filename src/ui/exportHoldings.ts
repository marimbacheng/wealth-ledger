import { COST_TERMS } from './costTerms';
import type { HoldingRow, Report } from '../engine/report';
import { DPS_SOURCE_LABEL } from '../engine/report';

// 持股明細匯出：Markdown（貼給 Claude 分析）與 CSV（Excel 開啟）。只在本機產生，不上傳。

interface Field {
  label: string;
  get: (h: HoldingRow) => string | number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const ratio = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : '');

export const EXPORT_FIELDS: Field[] = [
  { label: '代號', get: (h) => h.symbol },
  { label: '名稱', get: (h) => h.name },
  { label: '產業', get: (h) => h.sector },
  { label: '類別', get: (h) => h.assetClass },
  { label: '幣別', get: (h) => h.currency },
  { label: '股數', get: (h) => r4(h.qty) },
  { label: '現價(原幣)', get: (h) => (h.price != null ? r2(h.price) : '') },
  { label: '價格日', get: (h) => h.priceDate ?? '' },
  { label: '市值(原幣)', get: (h) => r2(h.native.marketValue) },
  { label: '市值(USD)', get: (h) => r2(h.marketValue) },
  { label: '比重%', get: (h) => r2(h.weight * 100) },
  { label: 'Schwab成本(原幣)', get: (h) => r2(h.native.schwabCost) },
  { label: '永豐成本(原幣)', get: (h) => r2(h.native.twCost) },
  { label: '券商成本(原幣)', get: (h) => r2(h.native.brokerCost) },
  { label: '券商成本(USD)', get: (h) => r2(h.brokerCost) },
  { label: '帳面盈虧(券商成本・USD)', get: (h) => r2(h.brokerGain) },
  { label: '報酬率%(券商成本)', get: (h) => ratio(h.brokerGain, h.brokerCost) },
  { label: '延續成本(原幣)', get: (h) => r2(h.native.contCost) },
  { label: '延續成本(USD)', get: (h) => r2(h.contCost) },
  { label: '帳面盈虧(延續成本・USD)', get: (h) => r2(h.contGain) },
  { label: '報酬率%(延續成本)', get: (h) => ratio(h.contGain, h.contCost) },
  { label: '年化每股股利(稅前・原幣)', get: (h) => r4(h.forecast.dps) },
  { label: '股利預估來源', get: (h) => DPS_SOURCE_LABEL[h.forecast.dpsSource] },
  { label: '預扣稅率%', get: (h) => r2(h.forecast.rate * 100) },
  { label: '預估年股息(稅前・USD)', get: (h) => r2(h.forecast.gross) },
  { label: '預估年股息(稅後・USD)', get: (h) => r2(h.forecast.net) },
  { label: '殖利率%(現價)', get: (h) => (h.price ? r2((h.forecast.dps / h.price) * 100) : '') },
  { label: '成本殖利率%(延續成本・稅後)', get: (h) => ratio(h.forecast.net, h.contCost) },
  { label: '成本殖利率%(券商成本・稅後)', get: (h) => ratio(h.forecast.net, h.brokerCost) },
  { label: '累積股利(稅後・USD)', get: (h) => r2(h.dividends?.net ?? 0) },
  { label: '股利再投入增加股數', get: (h) => r4(h.drip?.qty ?? 0) },
];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function holdingsCsv(rows: HoldingRow[]): string {
  const lines = [EXPORT_FIELDS.map((f) => csvCell(f.label)).join(',')];
  for (const h of rows) lines.push(EXPORT_FIELDS.map((f) => csvCell(f.get(h))).join(','));
  return '﻿' + lines.join('\n') + '\n';
}

const mdCell = (v: string | number) => String(v).replace(/\|/g, '\\|');

export function holdingsMarkdown(r: Report, rows: HoldingRow[]): string {
  const t = r.totals;
  const cov = r.coverage.map((c) => `${c.label} ${c.from}～${c.to}`).join('；');
  const head = [
    `# 持股明細（資料日 ${r.asOf}；合計單位 USD${r.fx ? `，匯率 1 USD = ${r.fx.rate} TWD（${r.fx.date ?? ''}）` : ''}）`,
    '',
    '## 合計',
    `- 市值 ${r2(t.marketValue)}；現金 ${r2(t.schwabCash + t.twCash)}；總值 ${r2(t.totalValue)}`,
    `- 券商成本（Schwab ${r2(t.brokerCost - t.twCost)} ＋ 永豐 ${r2(t.twCost)}）${r2(t.brokerCost)} USD，帳面盈虧 ${r2(t.brokerGain)}`,
    `- 延續成本 ${r2(t.contCost)}，帳面盈虧 ${r2(t.contGain)}`,
    `- 未來 12 個月預估股息：稅前 ${r2(r.forecast.gross)}、稅後 ${r2(r.forecast.net)}（${r.forecast.label}）`,
    `- 累積股利：稅前 ${r2(r.dividends.total.gross)}、預扣稅 ${r2(r.dividends.total.tax)}、稅後 ${r2(r.dividends.total.net)}`,
    '',
    '## 欄位說明',
    ...COST_TERMS.map((c) => `- ${c.name}：${c.what}用途：${c.use}。`),
    '- 預扣稅率取自實際入帳紀錄（台股預設 0%）；成本殖利率以未來 12 個月預估稅後股息計算。',
    '- 台股以台幣記帳，「(原幣)」欄為台幣；「(USD)」欄用目前匯率換算。',
    `- 資料涵蓋：${cov || '無'}。累積股利與已實現損益只含已匯入的期間。`,
    '',
    '## 明細',
    '',
  ];
  const table = [
    `| ${EXPORT_FIELDS.map((f) => f.label).join(' | ')} |`,
    `| ${EXPORT_FIELDS.map(() => '---').join(' | ')} |`,
    ...rows.map((h) => `| ${EXPORT_FIELDS.map((f) => mdCell(f.get(h))).join(' | ')} |`),
  ];
  return [...head, ...table, ''].join('\n');
}
