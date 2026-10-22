import type { RealizedRecord, Store, Txn } from '../domain/types';
import type { ImportBatch } from '../import/batch';

export interface MergeResult {
  store: Store;
  added: number;
  skipped: number;
  warnings: string[];
}

const TRADE_LABEL: Record<string, string> = { BUY: '買進', SELL: '賣出', OPEN: '期初持股' };

// 同一筆成交從不同管道進來（範本、手動、券商對帳單），或補了手續費後重新匯入，金額或拆單方式不同就逃過去重。
// 新加入的買賣若同券商、同日、同代號、同方向已經有紀錄，提醒使用者確認；不自動刪，因為同一天分批買也是正常的。
function possibleDuplicates(existing: Txn[], added: Txn[]): string[] {
  const key = (t: Txn) => `${t.broker}|${t.date}|${t.type}|${t.symbol}`;
  const have = new Map<string, Txn[]>();
  for (const t of existing) if (TRADE_LABEL[t.type] && t.symbol) have.set(key(t), [...(have.get(key(t)) ?? []), t]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of added) {
    const k = key(t);
    const prev = have.get(k);
    if (!prev || seen.has(k)) continue;
    seen.add(k);
    const qty = (xs: { qty?: number }[]) => xs.reduce((a, x) => a + (x.qty ?? 0), 0);
    const now = added.filter((x) => key(x) === k);
    out.push(
      `${t.date} ${t.symbol} ${TRADE_LABEL[t.type]}：原本已有 ${prev.length} 筆共 ${qty(prev)} 股，這次又加入 ${now.length} 筆共 ${qty(now)} 股。若是同一筆成交重複了，請到「交易帳」刪掉其中一份。`,
    );
  }
  return out;
}

function txnKey(t: Omit<Txn, 'id'>): string {
  return [t.source, t.broker, t.date, t.type, t.rawAction ?? '', t.symbol ?? '', t.qty ?? '', t.price ?? '', t.amount].join('|');
}

// 交易去重：同一個 key 在新檔出現 c 次、既有資料有 e 次 → 只補 max(0, c−e) 筆。
// 這樣重複匯入同一檔、或兩份日期重疊的匯出都不會重複計算，而同一天兩筆一模一樣的真實交易也不會被吃掉。
export function mergeTxns(existing: Txn[], incoming: Omit<Txn, 'id'>[]): { txns: Txn[]; added: number; skipped: number } {
  const have = new Map<string, number>();
  for (const t of existing) {
    const k = txnKey(t);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out = [...existing];
  let added = 0;
  let skipped = 0;
  for (const t of incoming) {
    const k = txnKey(t);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= (have.get(k) ?? 0)) {
      skipped++;
      continue;
    }
    out.push({ ...t, id: `${k}#${n}` });
    added++;
  }
  return { txns: out, added, skipped };
}

function sameRealized(a: Omit<RealizedRecord, 'id'>, b: Omit<RealizedRecord, 'id'>): boolean {
  return (
    a.broker === b.broker &&
    a.closedDate === b.closedDate &&
    a.symbol === b.symbol &&
    Math.abs(a.proceeds - b.proceeds) < 0.1
  );
}

export function mergeBatch(store: Store, batch: ImportBatch, now = new Date().toISOString()): MergeResult {
  const s: Store = structuredClone(store);
  let added = 0;
  let skipped = 0;

  const before = s.txns.length;
  const tx = mergeTxns(s.txns, batch.txns);
  const warnings = possibleDuplicates(s.txns, tx.txns.slice(before).filter((t) => TRADE_LABEL[t.type] && t.symbol));
  s.txns = tx.txns;
  added += tx.added;
  skipped += tx.skipped;

  for (const r of batch.realized) {
    if (s.realized.some((x) => sameRealized(x, r))) {
      skipped++;
      continue;
    }
    s.realized.push({ ...r, id: `${r.broker}|${r.closedDate}|${r.symbol}|${r.proceeds}` });
    added++;
  }

  if (batch.snapshot) {
    const id = `${batch.snapshot.broker}|${batch.snapshot.date}`;
    s.snapshots = s.snapshots.filter((x) => x.id !== id);
    s.snapshots.push({ ...batch.snapshot, id });
    s.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    added++;
    for (const r of batch.snapshot.rows) {
      const cur = s.prices[r.symbol];
      if (r.price > 0 && (!cur || cur.date <= batch.snapshot.date)) {
        s.prices[r.symbol] = { price: r.price, date: batch.snapshot.date, source: `${batch.snapshot.broker} 持倉` };
      }
    }
  }

  if (batch.estimates) {
    s.estimates = s.estimates.filter((x) => x.broker !== batch.estimates!.broker);
    s.estimates.push(batch.estimates);
  }

  for (const vp of [...(batch.valuePoint ? [batch.valuePoint] : []), ...(batch.valuePoints ?? [])]) {
    const id = `${vp.source}|${vp.date}`;
    const existed = s.valuePoints.find((x) => x.id === id);
    s.valuePoints = s.valuePoints.filter((x) => x.id !== id);
    s.valuePoints.push({ ...vp, id });
    if (!batch.snapshot) {
      if (existed && existed.value === vp.value) skipped++;
      else added++;
    }
  }
  s.valuePoints.sort((a, b) => a.date.localeCompare(b.date));

  if (batch.coverage) {
    const c = batch.coverage;
    if (!s.coverage.some((x) => x.broker === c.broker && x.kind === c.kind && x.from === c.from && x.to === c.to)) {
      s.coverage.push(c);
    }
  }

  // 只補名稱，不覆蓋使用者自己改過的產業、股利設定
  for (const [sym, meta] of Object.entries(batch.securities)) {
    const cur = s.securities[sym] ?? {};
    if (!cur.name && meta.name) s.securities[sym] = { ...cur, name: meta.name };
  }

  s.imports.push({ at: now, file: batch.file, kind: batch.kind, added, skipped });
  return { store: s, added, skipped, warnings };
}
