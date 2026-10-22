import { Fragment } from 'react';
import type { PeriodStats, YearRow } from '../engine/performance';
import type { Analytics } from '../perf/useAnalytics';
import { pct, tone } from './format';

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function Cells({ s }: { s?: PeriodStats }) {
  if (!s) return <td colSpan={3} className="muted">—</td>;
  return (
    <>
      <td className={tone(s.ret)}>{pct(s.ret, 2, true)}</td>
      <td className="up">{pct(s.maxRise, 2, true)}</td>
      <td className="down">{pct(s.maxDrawdown, 2)}</td>
    </>
  );
}

// 每年三列：我的組合、S&P 500、NASDAQ；期間相同，才能比較
export function YearTable({ a }: { a: Analytics }) {
  if (!a.from) return <p className="muted">需要先設定報酬起算點，或匯入一份持倉快照。</p>;
  if (!a.perf) return <p className="muted">{a.busy ? '正在取得歷史價格…' : '歷史價格暫時取不到，稍後重新整理再試。'}</p>;
  const rows: YearRow[] = [...a.perf.years].reverse();
  const checks = a.perf.checks;
  const worst = checks.reduce((m, c) => Math.max(m, Math.abs(c.ours / c.official - 1)), 0);
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="l">年度</th>
              <th className="l">對象</th>
              <th>報酬率</th>
              <th>年內最大漲幅</th>
              <th>年內最大跌幅</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const partial = !r.from.endsWith('12-31') || !r.to.endsWith('12-31');
              return (
                <Fragment key={r.year}>
                  <tr>
                    <td className="l" rowSpan={3} style={{ verticalAlign: 'top' }}>
                      <strong>{r.year}</strong>
                      {partial && <div className="muted" style={{ fontSize: 11 }}>{`${r.from.endsWith('12-31') ? '1/1' : md(r.from)}～${md(r.to)}`}</div>}
                    </td>
                    <td className="l">
                      <strong>我的組合</strong>
                    </td>
                    <Cells s={r.portfolio} />
                  </tr>
                  <tr>
                    <td className="l muted">S&amp;P 500</td>
                    <Cells s={r.spx} />
                  </tr>
                  <tr>
                    <td className="l muted">NASDAQ</td>
                    <Cells s={r.ndx} />
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="desc" style={{ marginTop: 8 }}>
        我的組合是時間加權報酬：用每日收盤價和交易紀錄重建每天的帳戶總值，扣掉入金的影響，股利預扣稅已扣除。S&amp;P 500、NASDAQ 是價格指數，不含股息。年內最大漲幅＝從低點到之後高點的最大漲幅，最大跌幅＝從高點到之後低點的最大跌幅。
        {checks.length > 0 && ` 重建的每日總值和 Schwab 的 ${checks.length} 筆對帳資料比對，最大差 ${pct(worst, 2)}（Schwab 的期末值含應計股息、盤中匯出的時間不同）。`}
      </p>
      {checks.length > 0 && (
        <details>
          <summary>對帳明細</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">日期</th>
                  <th className="l">來源</th>
                  <th>Schwab</th>
                  <th>重建</th>
                  <th>差</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.date}>
                    <td className="l">{c.date}</td>
                    <td className="l">{c.note ?? ''}</td>
                    <td>{c.official.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</td>
                    <td>{c.ours.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</td>
                    <td>{pct(c.ours / c.official - 1, 2, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {a.missing.length > 0 && <p className="desc">這幾檔沒有取到歷史價格，用帳本裡最近的價格代替：{a.missing.join('、')}</p>}
    </>
  );
}
