// 成本名稱與定義：持股明細、總覽、股利頁與匯出共用同一套說法
export const COST_TERMS = [
  {
    name: '永豐成本',
    what: '在永豐買進實際付出的金額（含手續費），和永豐 App 顯示的成本相同。',
    use: '報稅、和永豐對帳',
  },
  {
    name: 'Schwab 成本',
    what: '還留在 Schwab 的部位，Schwab 帳上的成本。全數移到永豐後顯示「—」。',
    use: '和 Schwab 對帳',
  },
  {
    name: '券商成本',
    what: 'Schwab 成本 ＋ 永豐成本，兩家券商帳上的成本加總。遷移完成後就等於永豐成本。',
    use: '看「這次買進以來」的盈虧',
  },
  {
    name: '延續成本',
    what: '從第一次買進算起的成本。遷移的部位 = Schwab 時期的原始成本 ＋ 賣出到買回之間多付（或少付）的價差與手續費；換成其他代號買回的（例如 TSM → 2330）照比例接過去。沒有遷移的部位和券商成本相同。',
    use: '看「從第一次買進到現在」的盈虧與成本殖利率',
  },
] as const;

export const costHint = (name: (typeof COST_TERMS)[number]['name']) => {
  const t = COST_TERMS.find((x) => x.name === name)!;
  return `${t.name}：${t.what}用途：${t.use}。`;
};
