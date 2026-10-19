import { useRef, useState } from 'react';
import type { ImportResult, PageProps } from '../../App';
import { DEFAULT_META, metaFor } from '../../domain/securities';
import { emptyStore, type Store } from '../../domain/types';
import { TW_POS_HEADER, TW_TXN_HEADER } from '../../import/tw';
import { upgrade } from '../../store/persist';
import { Card, Notice } from '../components';
import { money, qty, today } from '../format';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TXN_EXAMPLE = [
  TW_TXN_HEADER.join(','),
  '2026-11-03,tw,轉入,,,,,,10000,,,,,Schwab 匯回',
  '2026-11-05,tw,買進,VOO,,10,500.00,3.00,,,,,,',
  '2026-11-05,tw,買進,BRK.B,,5,450.00,3.00,,,,,,',
  '2026-12-15,tw,股利,KO,,,,,,15.00,4.50,10.50,,',
  '2027-01-10,tw,股利,PEP,,,,,,,,20.00,,只知道實收金額',
  '2023-03-15,schwab,股利,JNJ,,,,,,20.00,6.00,,,補登早年資料',
].join('\n');
const POS_EXAMPLE = [TW_POS_HEADER.join(','), '2026-11-30,VOO,VANGUARD S&P 500 ETF,10,5003.00,510.00,', '2026-11-30,KO,COCA-COLA,30,2103.00,72.00,'].join('\n');

export function Setup({ store, report: r, update, importFiles }: PageProps & { importFiles: (f: File[]) => Promise<ImportResult[]> }) {
  const [results, setResults] = useState<ImportResult[]>([]);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [vp, setVp] = useState({ date: today(), value: '', note: '' });
  const [msg, setMsg] = useState<string[]>([]);
  const m = store.settings.migration;

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setResults(await importFiles([...list]));
  }

  const setMig = (k: keyof typeof m) => (e: { target: { value: string } }) =>
    update((s) => {
      s.settings.migration[k] = e.target.value;
      return s;
    });

  const symbols = [...new Set([...r.holdings.map((h) => h.symbol), ...Object.keys(r.dividends.bySymbol)])].sort();
  const sectorOptions = [...new Set([...Object.values(DEFAULT_META).map((d) => d.sector), ...Object.values(store.securities).map((s) => s.sector).filter(Boolean)])];

  function setMeta(sym: string, patch: Record<string, unknown>) {
    update((s) => {
      const cur = { ...(s.securities[sym] ?? {}), ...patch } as Record<string, unknown>;
      for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === '') delete cur[k];
      s.securities[sym] = cur;
      return s;
    });
  }

  function restore(file: File | undefined) {
    if (!file) return;
    file.text().then((text) => {
      try {
        const s = upgrade(JSON.parse(text));
        if (!window.confirm(`以備份檔取代目前資料？（備份內有 ${s.txns.length} 筆紀錄、${s.snapshots.length} 份持倉快照）`)) return;
        update(() => s);
        setMsg(['已從備份還原']);
      } catch (e) {
        setMsg([`還原失敗：${(e as Error).message}`]);
      }
    });
  }

  return (
    <>
      <div className="section">
        <Card title="匯入檔案" desc="可一次選多個檔案；程式依內容自動辨識格式。重複匯入同一份或日期重疊的匯出不會重複計算。">
          <div
            className={`drop ${over ? 'over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => (e.preventDefault(), setOver(false), onFiles(e.dataTransfer.files))}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
          >
            把 CSV 拖到這裡，或點一下選擇檔案
            <input ref={fileRef} type="file" accept=".csv,.CSV,text/csv" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          </div>
          {results.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th className="l">檔案</th>
                    <th className="l">辨識為</th>
                    <th>新增</th>
                    <th>略過（重複）</th>
                    <th className="l">提醒</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((x, i) => (
                    <tr key={i}>
                      <td className="l">{x.file}</td>
                      <td className="l">{x.label}</td>
                      <td>{x.added}</td>
                      <td>{x.skipped}</td>
                      <td className="l" style={{ whiteSpace: 'normal' }}>
                        {x.warnings.slice(0, 5).join('；')}
                        {x.warnings.length > 5 && `…等 ${x.warnings.length} 則`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary>要從 Schwab 匯出哪些檔案？</summary>
            <ul>
              <li>
                <strong>Positions</strong>（持倉）：延續帳的起點，提供每檔的原始成本。<em>賣出前一定要先匯出一份</em>。
              </li>
              <li>
                <strong>Transactions / History</strong>（交易紀錄）：股利、預扣稅、再投入、買賣。日期範圍請拉到最早，分段匯出也可以。
              </li>
              <li>
                <strong>Investment Income</strong>（投資收益）：較早年度的稅前股利，以及未來 12 個月預估股利。
              </li>
              <li>
                <strong>Realized Gain/Loss</strong>（已實現損益）：日期範圍拉到最早；彙總或逐批明細擇一即可，兩個都匯也不會重複。
              </li>
              <li>
                <strong>Balances</strong>（餘額）：記一個資產快照點。
              </li>
              <li>在複委託把股票全部賣掉、錢匯出後，再匯出一次交易紀錄與已實現損益，遷移配對才會完整。</li>
            </ul>
          </details>
        </Card>
      </div>

      <div className="grid two">
        <Card title="遷移設定" desc="在這段期間內的 Schwab 賣出與複委託買進會配對，用來把原始成本延續到新部位。">
          <div className="row">
            <label className="field">
              Schwab 賣出 起
              <input type="date" value={m.schwabSellFrom} onChange={setMig('schwabSellFrom')} />
            </label>
            <label className="field">
              迄
              <input type="date" value={m.schwabSellTo} onChange={setMig('schwabSellTo')} />
            </label>
            <label className="field">
              複委託買回 起
              <input type="date" value={m.twBuyFrom} onChange={setMig('twBuyFrom')} />
            </label>
            <label className="field">
              迄
              <input type="date" value={m.twBuyTo} onChange={setMig('twBuyTo')} />
            </label>
          </div>
          <p className="desc" style={{ marginTop: 8 }}>
            延續帳起算快照：{r.anchorDate ?? '尚無'}（遷移開始前最後一份 Schwab 持倉）。買回期限過後仍沒配對到的賣出（例如零股），在延續帳視為已實現。期間內從 Schwab 匯出的款項視為券商間移轉，不算提領。
          </p>
          {r.migration.matches.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="l">代號</th>
                    <th>股數</th>
                    <th>原始成本</th>
                    <th>Schwab 賣出所得</th>
                    <th>複委託買進成本</th>
                    <th>延續成本</th>
                  </tr>
                </thead>
                <tbody>
                  {r.migration.matches.map((x, i) => (
                    <tr key={i}>
                      <td className="l">{x.symbol}</td>
                      <td>{qty(Number(x.qty.toFixed(4)))}</td>
                      <td>{money(x.originalCost)}</td>
                      <td>{money(x.proceeds)}</td>
                      <td>{money(x.newCost)}</td>
                      <td>{money(x.carriedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.migration.pending.length > 0 && (
            <Notice
              title="遷移中（已賣出、尚未買回）"
              items={r.migration.pending.map((p) => `${p.symbol} ${qty(Number(p.qty.toFixed(4)))} 股，賣出所得 ${money(p.proceeds)}（${p.sellDate}）`)}
            />
          )}
        </Card>

        <Card title="淨投入與預設值" desc="期初累計淨投入 = 這個日期以前，從台灣匯到海外券商（含更早的券商時期）的總金額減去匯出。之後的匯入會從交易紀錄自動加上。">
          <div className="row">
            <label className="field">
              截至日期
              <input
                type="date"
                value={store.settings.openingContribution?.date ?? ''}
                onChange={(e) =>
                  update((s) => {
                    s.settings.openingContribution = { amount: s.settings.openingContribution?.amount ?? 0, date: e.target.value };
                    return s;
                  })
                }
              />
            </label>
            <label className="field">
              累計淨投入（USD）
              <input
                type="number"
                step="any"
                value={store.settings.openingContribution?.amount ?? ''}
                onChange={(e) =>
                  update((s) => {
                    const v = e.target.value;
                    if (v === '') delete s.settings.openingContribution;
                    else s.settings.openingContribution = { date: s.settings.openingContribution?.date ?? r.coverage[0]?.from ?? today(), amount: Number(v) };
                    return s;
                  })
                }
              />
            </label>
            <label className="field">
              預設預扣稅率（%）
              <input
                type="number"
                step="1"
                value={Math.round(store.settings.defaultWithholding * 100)}
                onChange={(e) =>
                  update((s) => {
                    s.settings.defaultWithholding = Number(e.target.value) / 100;
                    return s;
                  })
                }
              />
            </label>
          </div>
        </Card>
      </div>

      <div className="section">
        <Card title="資產快照" desc="資產成長趨勢圖的資料點。匯入持倉或餘額時會自動新增；也可以從舊對帳單補登月底總值。">
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="field">
              日期
              <input type="date" value={vp.date} onChange={(e) => setVp({ ...vp, date: e.target.value })} />
            </label>
            <label className="field">
              帳戶總值（USD）
              <input type="number" step="any" value={vp.value} onChange={(e) => setVp({ ...vp, value: e.target.value })} />
            </label>
            <label className="field">
              備註
              <input value={vp.note} onChange={(e) => setVp({ ...vp, note: e.target.value })} />
            </label>
            <button
              className="primary"
              disabled={!vp.value || !vp.date}
              onClick={() =>
                update((s) => {
                  const id = `manual|${vp.date}`;
                  s.valuePoints = s.valuePoints.filter((x) => x.id !== id);
                  s.valuePoints.push({ id, date: vp.date, value: Number(vp.value), source: 'manual', note: vp.note || undefined });
                  s.valuePoints.sort((a, b) => a.date.localeCompare(b.date));
                  setVp({ date: today(), value: '', note: '' });
                  return s;
                })
              }
            >
              新增
            </button>
            <button onClick={() => setVp({ date: today(), value: r.totals.totalValue.toFixed(2), note: '以目前價格估算' })}>帶入目前總值</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 280 }}>
            <table>
              <thead>
                <tr>
                  <th className="l">日期</th>
                  <th>總值</th>
                  <th className="l">來源</th>
                  <th className="l">備註</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...store.valuePoints].reverse().map((p) => (
                  <tr key={p.id}>
                    <td className="l">{p.date}</td>
                    <td>{money(p.value)}</td>
                    <td className="l">{{ manual: '手動', balances: '餘額匯出', snapshot: '持倉匯出' }[p.source]}</td>
                    <td className="l muted">{p.note}</td>
                    <td>
                      <button
                        className="danger"
                        aria-label="刪除"
                        onClick={() =>
                          update((s) => {
                            s.valuePoints = s.valuePoints.filter((x) => x.id !== p.id);
                            return s;
                          })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="section">
        <Card title="個股設定" desc="產業分類、手動現價、年化每股股利與預扣稅率覆寫。空白代表使用自動值。">
          <datalist id="sectors">
            {sectorOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table>
              <thead>
                <tr>
                  <th className="l">代號</th>
                  <th className="l">產業</th>
                  <th>現價</th>
                  <th className="l">價格日</th>
                  <th>年化每股股利（覆寫）</th>
                  <th>預扣稅率 %（覆寫）</th>
                </tr>
              </thead>
              <tbody>
                {symbols.map((sym) => {
                  const meta = metaFor(sym, store.securities);
                  const p = store.prices[sym];
                  const h = r.holdings.find((x) => x.symbol === sym);
                  return (
                    <tr key={sym}>
                      <td className="l">
                        {sym}
                        {!h && <span className="muted">（已出清）</span>}
                      </td>
                      <td className="l">
                        <input list="sectors" defaultValue={store.securities[sym]?.sector ?? ''} placeholder={meta.sector} onBlur={(e) => setMeta(sym, { sector: e.target.value || undefined })} style={{ width: 140 }} />
                      </td>
                      <td>
                        {h ? (
                          <input
                            type="number"
                            step="any"
                            defaultValue={p?.price ?? ''}
                            key={`${sym}-${p?.date}-${p?.price}`}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (!v || Number(v) === p?.price) return;
                              update((s) => {
                                s.prices[sym] = { price: Number(v), date: today(), source: '手動' };
                                return s;
                              });
                            }}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="l muted">
                        {p?.date} {p?.source}
                      </td>
                      <td>
                        <input type="number" step="any" defaultValue={store.securities[sym]?.dpsOverride ?? ''} placeholder={h ? h.forecast.dps.toFixed(4) : ''} onBlur={(e) => setMeta(sym, { dpsOverride: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="1"
                          defaultValue={store.securities[sym]?.withholdingOverride != null ? Math.round(store.securities[sym]!.withholdingOverride! * 100) : ''}
                          placeholder={r.dividends.rates[sym] != null ? String(Math.round(r.dividends.rates[sym] * 100)) : String(Math.round(store.settings.defaultWithholding * 100))}
                          onBlur={(e) => setMeta(sym, { withholdingOverride: e.target.value === '' ? undefined : Number(e.target.value) / 100 })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid two">
        <Card title="複委託匯入範本" desc="台灣各券商匯出格式不同；把資料整理成這個欄位順序（UTF-8 或 Big5 皆可）即可匯入。券商欄填 schwab 可補登早年資料。">
          <div className="row">
            <button onClick={() => download('複委託交易範本.csv', '\uFEFF' + TXN_EXAMPLE, 'text/csv')}>下載交易／股利範本</button>
            <button onClick={() => download('複委託庫存範本.csv', '\uFEFF' + POS_EXAMPLE, 'text/csv')}>下載庫存範本（對帳用）</button>
          </div>
          <p className="desc" style={{ marginTop: 8 }}>
            類別：買進、賣出、股利、轉入、轉出、入金、出金、費用、利息。股利欄填稅前、預扣稅、稅後任兩個；只知道實收就只填稅後。
          </p>
        </Card>

        <Card title="備份與還原" desc="資料只在這個瀏覽器裡。定期下載備份，換電腦時用備份還原。">
          <div className="row">
            <button className="primary" onClick={() => download(`wealth-ledger-backup-${today()}.json`, JSON.stringify(store, null, 1), 'application/json')}>
              下載備份
            </button>
            <button onClick={() => restoreRef.current?.click()}>從備份還原</button>
            <input ref={restoreRef} type="file" accept=".json,application/json" hidden onChange={(e) => (restore(e.target.files?.[0]), (e.target.value = ''))} />
            <button
              className="danger"
              onClick={() => {
                if (window.confirm('清除這個瀏覽器裡的所有資料？建議先下載備份。')) update((): Store => emptyStore());
              }}
            >
              清除所有資料
            </button>
          </div>
          <Notice items={msg} />
          <p className="desc" style={{ marginTop: 8 }}>
            目前：{store.txns.length} 筆紀錄、{store.snapshots.length} 份持倉快照、{store.realized.length} 筆已實現、{store.imports.length} 次匯入。
          </p>
        </Card>
      </div>
    </>
  );
}
