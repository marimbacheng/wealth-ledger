import type { QuotesApi } from '../quotes/useQuotes';
import { Card } from './components';

const hhmm = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 報價狀態一行字：上次更新時間、這次更新幾檔、哪些沒抓到
export function quotesStatus(q: QuotesApi): string {
  if (q.busy) return '報價更新中…';
  if (q.error) return q.error;
  if (!q.at) return '還沒有自動更新過報價';
  const miss = Object.keys(q.missing);
  return [`報價更新於 ${hhmm(q.at)}`, q.updated != null ? `本次更新 ${q.updated} 檔` : '', miss.length ? `${miss.length} 檔沒抓到（${miss.join('、')}），沿用原價格` : '']
    .filter(Boolean)
    .join('；');
}

export function QuotesButton({ quotes }: { quotes: QuotesApi }) {
  return (
    <button onClick={() => void quotes.refresh()} disabled={quotes.busy} title={Object.entries(quotes.missing).map(([s, e]) => `${s}：${e}`).join('\n') || undefined}>
      {quotes.busy ? '更新中…' : '更新報價'}
    </button>
  );
}

export function QuotesCard({ quotes }: { quotes: QuotesApi }) {
  return (
    <Card
      title="報價"
      desc="台股用證交所（上市）與櫃買中心（上櫃）公布的每日收盤價（查不到時改用 Yahoo），美股用 Yahoo 的報價（盤中約延遲幾分鐘、收盤後為收盤價）。透過本站的 Cloudflare 轉送，只送出代號，不含股數與金額。同一天手動輸入的價格不會被蓋掉。"
    >
      <div className="row">
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={quotes.auto} onChange={(e) => quotes.setAuto(e.target.checked)} />
          自動更新：開啟網站時（超過 30 分鐘才重抓）、開盤時間每分鐘一次（只記在這台裝置）
        </label>
        <QuotesButton quotes={quotes} />
      </div>
      <p className="desc" style={{ marginTop: 8 }}>
        {quotesStatus(quotes)}
      </p>
      {Object.keys(quotes.missing).length > 0 && (
        <ul className="desc" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {Object.entries(quotes.missing).map(([s, e]) => (
            <li key={s}>
              {s}：{e}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
