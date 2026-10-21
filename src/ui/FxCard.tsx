import { useState } from 'react';
import type { Store } from '../domain/types';
import type { FxApi } from '../fx/useFx';
import { Card, Notice } from './components';

// 匯率與跨市場對應（例如 TSM ADR → 台股 2330）
export function FxCard({ store, update, fx }: { store: Store; update: (fn: (s: Store) => Store) => void; fx: FxApi }) {
  const cur = store.fx?.current;
  const [manual, setManual] = useState('');
  const [map, setMap] = useState({ from: '', to: '', ratio: '' });
  const mappings = store.settings.migration.mappings ?? [];

  return (
    <Card title="匯率與跨市場對應" desc="台股以台幣記帳，合計時用匯率換成美元（也可在頁首切成台幣顯示）。匯率每 12 小時自動更新一次；台幣交易會用當天匯率。">
      <div className="kv" style={{ maxWidth: 520 }}>
        <span>目前匯率</span>
        <span>{cur ? `1 美元 = ${cur.rate} 台幣` : '尚未取得'}</span>
        <span>資料日期</span>
        <span>{cur?.date ?? '—'}</span>
        <span>來源</span>
        <span>{cur?.source ?? '—'}</span>
        <span>已快取的歷史匯率</span>
        <span>{Object.keys(store.fx?.history ?? {}).length} 天</span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => void fx.refresh()} disabled={fx.busy}>
          {fx.busy ? '更新中…' : '立即更新匯率'}
        </button>
        <label className="field">
          手動指定目前匯率
          <input type="number" step="any" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="例如 32.5" style={{ width: 110 }} />
        </label>
        <button
          disabled={!(Number(manual) > 15 && Number(manual) < 60)}
          onClick={() => {
            fx.setManual(Number(manual));
            setManual('');
          }}
        >
          套用
        </button>
      </div>
      {fx.error && <Notice items={[fx.error]} />}

      <h3>跨市場對應（遷移時用）</h3>
      <p className="desc">Schwab 賣出的代號，在永豐改買另一個代號時，原始成本照比例接過去。例如 1 股 TSM（ADR）= 5 股台積電 2330。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="l">Schwab 賣出</th>
              <th className="l">永豐買回</th>
              <th>1 股換幾股</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => (
              <tr key={`${m.from}-${m.to}`}>
                <td className="l">{m.from}</td>
                <td className="l">{m.to}</td>
                <td>{m.ratio}</td>
                <td>
                  <button
                    className="danger"
                    aria-label="刪除"
                    onClick={() =>
                      update((s) => {
                        s.settings.migration.mappings = (s.settings.migration.mappings ?? []).filter((_, j) => j !== i);
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
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">
          Schwab 代號
          <input value={map.from} onChange={(e) => setMap({ ...map, from: e.target.value.toUpperCase() })} style={{ width: 90 }} />
        </label>
        <label className="field">
          永豐代號
          <input value={map.to} onChange={(e) => setMap({ ...map, to: e.target.value.toUpperCase() })} style={{ width: 90 }} />
        </label>
        <label className="field">
          1 股換幾股
          <input type="number" step="any" value={map.ratio} onChange={(e) => setMap({ ...map, ratio: e.target.value })} style={{ width: 90 }} />
        </label>
        <button
          disabled={!map.from || !map.to || !(Number(map.ratio) > 0)}
          onClick={() => {
            update((s) => {
              s.settings.migration.mappings = [...(s.settings.migration.mappings ?? []).filter((m) => !(m.from === map.from && m.to === map.to)), { from: map.from, to: map.to, ratio: Number(map.ratio) }];
              return s;
            });
            setMap({ from: '', to: '', ratio: '' });
          }}
        >
          新增對應
        </button>
      </div>
    </Card>
  );
}
