import type { HoldingRow } from '../engine/report';

// 成本名稱與定義：持股明細、總覽、股利頁與匯出共用同一套說法。
// Schwab 已經沒有持股時，券商成本就等於永豐成本，只留「永豐成本」與「延續成本」兩個名詞。

export const schwabHolds = (holdings: HoldingRow[]) => holdings.some((h) => h.schwabQty > 1e-6);

export const brokerCostName = (holds: boolean) => (holds ? '券商成本' : '永豐成本');

export interface CostTerm {
  name: string;
  what: string;
  use: string;
}

const TW: CostTerm = {
  name: '永豐成本',
  what: '在永豐買進實際付出的金額（含手續費），和永豐 App 顯示的成本相同。',
  use: '報稅、和永豐對帳',
};
const SCHWAB: CostTerm = {
  name: 'Schwab 成本',
  what: '還留在 Schwab 的部位，Schwab 帳上的成本。',
  use: '和 Schwab 對帳',
};
const BROKER: CostTerm = {
  name: '券商成本',
  what: 'Schwab 成本 ＋ 永豐成本，兩家券商帳上的成本加總。Schwab 全數移轉後就等於永豐成本。',
  use: '看「這次買進以來」的盈虧',
};
const CONT: CostTerm = {
  name: '延續成本',
  what: '從第一次買進算起的成本 = Schwab 時期的原始成本 ＋ 移轉時的價差與手續費 ＋ 之後在永豐新買的成本。換成其他代號買回的（例如 TSM → 2330）照比例接過去。',
  use: '看「從第一次買進到現在」的盈虧與成本殖利率',
};

export function costTerms(holds: boolean): CostTerm[] {
  return holds ? [SCHWAB, TW, BROKER, CONT] : [TW, CONT];
}

// 兩種成本差在哪：不是手續費（兩邊都含），而是移轉前在 Schwab 已經賺到的部分
export const costGapNote = (holds: boolean) =>
  `延續成本 − ${brokerCostName(holds)} = −（移轉時 Schwab 賣出所得 − 原始成本），也就是移轉前在 Schwab 已經賺到、被接進延續成本的獲利；移轉的價差與手續費兩邊都已算進去，不是差異來源。`;

export const costHint = (holds: boolean, name: string) => {
  const t = costTerms(holds).find((x) => x.name === name);
  return t ? `${t.name}：${t.what}用途：${t.use}。` : undefined;
};
