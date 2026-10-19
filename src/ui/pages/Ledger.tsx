import { useMemo, useState } from 'react';
import type { PageProps } from '../../App';
import type { TxnType } from '../../domain/types';
import { parseTwTransactions, TW_TXN_HEADER } from '../../import/tw';
import { mergeTxns } from '../../store/merge';
import { Card, Notice } from '../components';
import { money, qty, today } from '../format';

const TYPE_LABEL: Record<TxnType, string> = {
  BUY: '買進',
  SELL: '賣出',
  DIV: '股利',
  TAX: '預扣稅',
  INTEREST: '利息',
  DEPOSIT: '入金',
  WITHDRAW: '出金',
  TRANSFER_OUT: '轉出',
  TRANSFER_IN: '轉入',
  FEE: '費用',
  OTHER: '其他',
};

const SOURCE_LABEL: Record<string, string> = {
  'schwab-transactions': 'Schwab 交易紀錄',
  'schwab-income': 'Schwab 投資收益',
  'tw-csv': '範本匯入',
  manual: '手動',
};

type Form = Record<(typeof TW_TXN_HEADER)[number], string>;
const blank = (): Form => ({
  日期: today(),
  券商: 'tw',
  類別: '買進',
  代號: '',
  名稱: '',
  股數: '',
  價格: '',
  手續費: '',
  金額: '',
  稅前股利: '',
  預扣稅: '',
  稅後股利: '',
  再投入: '',
  備註: '',
});

export function Ledger({ store, update }: PageProps) {
  const [broker, setBroker] = useState('');
  const [type, setType] = useState('');
  const [sym, setSym] = useState('');
  const [limit, setLimit] = useState(200);
  const [form, setForm] = useState<Form>(blank);
  const [msg, setMsg] = useState<string[]>([]);

  const rows = useMemo(
    () =>
      store.txns
        .filter((t) => (!broker || t.broker === broker) && (!type || t.type === type) && (!sym || t.symbol === sym))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [store.txns, broker, type, sym],
  );
  const symbols = useMemo(() => [...new Set(store.txns.map((t) => t.symbol).filter(Boolean) as string[])].sort(), [store.txns]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cat = form.類別;
  const isTrade = cat === '買進' || cat === '賣出';
  const isDiv = cat === '股利';

  // 手動新增走跟範本匯入同一套解析，規則只有一份
  function add() {
    const b = parseTwTransactions([[...TW_TXN_HEADER], TW_TXN_HEADER.map((h) => form[h])], '手動輸入');
    if (b.txns.length === 0) {
      setMsg(b.warnings.length ? b.warnings.map((w) => w.replace('第 2 列：', '')) : ['沒有可新增的資料']);
      return;
    }
    const txns = b.txns.map((t) => ({ ...t, source: 'manual' }));
    update((s) => {
      s.txns = mergeTxns(s.txns, txns).txns;
      for (const [k, v] of Object.entries(b.securities)) if (!s.securities[k]?.name) s.securities[k] = { ...s.securities[k], ...v };
      return s;
    });
    setMsg([`已新增 ${txns.length} 筆`, ...b.warnings.map((w) => w.replace('第 2 列：', ''))]);
    setForm((f) => ({ ...blank(), 日期: f.日期, 券商: f.券商, 類別: f.類別 }));
  }

  function remove(id: string) {
    if (!window.confirm('刪除這筆紀錄？（若是匯入的資料，重新匯入同一檔案會再加回來）')) return;
    update((s) => {
      s.txns = s.txns.filter((t) => t.id !== id);
      return s;
    });
  }

  return (
    <>
      <div className="section">
        <Card title="新增一筆" desc="複委託的買進、賣出、股利；或補登 Schwab 早年資料（券商選 Schwab）。從 Schwab 匯到台灣的錢，在複委託這邊記「轉入」。">
          <div className="row">
            <label className="field">
              日期
              <input type="date" value={form.日期} onChange={set('日期')} />
            </label>
            <label className="field">
              券商
              <select value={form.券商} onChange={set('券商')}>
                <option value="tw">複委託</option>
                <option value="schwab">Schwab</option>
              </select>
            </label>
            <label className="field">
              類別
              <select value={form.類別} onChange={set('類別')}>
                {['買進', '賣出', '股利', '轉入', '轉出', '入金', '出金', '費用', '利息'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {(isTrade || isDiv) && (
              <label className="field">
                代號
                <input value={form.代號} onChange={set('代號')} placeholder="AAPL" style={{ width: 90 }} />
              </label>
            )}
            {isTrade && (
              <>
                <label className="field">
                  股數
                  <input type="number" step="any" value={form.股數} onChange={set('股數')} />
                </label>
                <label className="field">
                  成交價
                  <input type="number" step="any" value={form.價格} onChange={set('價格')} />
                </label>
                <label className="field">
                  手續費
                  <input type="number" step="any" value={form.手續費} onChange={set('手續費')} />
                </label>
                {cat === '買進' && (
                  <label className="field">
                    股利再投入
                    <select value={form.再投入} onChange={set('再投入')}>
                      <option value="">否</option>
                      <option value="是">是</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {isDiv && (
              <>
                <label className="field">
                  稅前股利
                  <input type="number" step="any" value={form.稅前股利} onChange={set('稅前股利')} />
                </label>
                <label className="field">
                  預扣稅
                  <input type="number" step="any" value={form.預扣稅} onChange={set('預扣稅')} />
                </label>
                <label className="field">
                  稅後股利
                  <input type="number" step="any" value={form.稅後股利} onChange={set('稅後股利')} />
                </label>
              </>
            )}
            {!isTrade && !isDiv && (
              <label className="field">
                金額
                <input type="number" step="any" value={form.金額} onChange={set('金額')} />
              </label>
            )}
            <label className="field">
              備註
              <input value={form.備註} onChange={set('備註')} />
            </label>
            <button className="primary" onClick={add}>
              新增
            </button>
          </div>
          {isDiv && <p className="desc" style={{ marginTop: 6 }}>稅前、預扣稅、稅後填任兩個即可；只知道實收金額就只填稅後，會標記為「僅有實收淨額」。</p>}
          <div style={{ marginTop: 8 }}>
            <Notice items={msg} />
          </div>
        </Card>
      </div>

      <Card title="所有紀錄" desc={`${rows.length} 筆`}>
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="field">
            券商
            <select value={broker} onChange={(e) => setBroker(e.target.value)}>
              <option value="">全部</option>
              <option value="schwab">Schwab</option>
              <option value="tw">複委託</option>
            </select>
          </label>
          <label className="field">
            類別
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            代號
            <select value={sym} onChange={(e) => setSym(e.target.value)}>
              <option value="">全部</option>
              {symbols.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap" style={{ maxHeight: 640 }}>
          <table>
            <thead>
              <tr>
                <th className="l">日期</th>
                <th className="l">券商</th>
                <th className="l">類別</th>
                <th className="l">代號</th>
                <th>股數</th>
                <th>價格</th>
                <th>手續費</th>
                <th>金額</th>
                <th className="l">原始動作</th>
                <th className="l">來源</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((t) => (
                <tr key={t.id}>
                  <td className="l">{t.date}</td>
                  <td className="l">{t.broker === 'schwab' ? 'Schwab' : '複委託'}</td>
                  <td className="l">
                    {TYPE_LABEL[t.type]}
                    {t.drip && <span className="badge">再投入</span>}
                    {t.netOnly && <span className="badge est">僅淨額</span>}
                  </td>
                  <td className="l">{t.symbol ?? ''}</td>
                  <td>{t.qty != null ? qty(t.qty) : ''}</td>
                  <td>{t.price != null ? money(t.price) : ''}</td>
                  <td>{t.fee ? money(t.fee) : ''}</td>
                  <td>{money(t.amount)}</td>
                  <td className="l muted">{t.rawAction ?? ''}</td>
                  <td className="l muted">{SOURCE_LABEL[t.source] ?? t.source}</td>
                  <td>
                    <button className="danger" onClick={() => remove(t.id)} aria-label="刪除" title="刪除">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button style={{ marginTop: 8 }} onClick={() => setLimit((l) => l + 500)}>
            顯示更多（還有 {rows.length - limit} 筆）
          </button>
        )}
      </Card>
    </>
  );
}
