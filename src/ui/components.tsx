import type { ReactNode } from 'react';
import type { DividendTotals, TaxStatus } from '../engine/dividends';
import { money, pct, tone } from './format';

export function Card(props: { title?: ReactNode; desc?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {props.title && <h2>{props.title}</h2>}
      {props.desc && <p className="desc">{props.desc}</p>}
      {props.children}
    </section>
  );
}

// 報告式區塊：上緣粗細線 + 編號 + 襯線標題
export function Section(props: { no?: string; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        {props.no && <span className="no">{props.no}</span>}
        <h2>{props.title}</h2>
        {props.aside && <span className="aside">{props.aside}</span>}
      </div>
      {props.children}
    </section>
  );
}

// 點線引導的帳目列（像財報的科目與金額）
export function Leaders({ rows }: { rows: ({ k: ReactNode; v: ReactNode; cls?: string; total?: boolean } | false | undefined)[] }) {
  return (
    <ul className="leaders">
      {rows.filter(Boolean).map((r, i) => {
        const x = r as { k: ReactNode; v: ReactNode; cls?: string; total?: boolean };
        return (
          <li key={i} className={x.total ? 'total' : ''}>
            <span className="k">{x.k}</span>
            <span className="dots" />
            <span className={`v ${x.cls ?? ''}`}>{x.v}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Kpi(props: { label: ReactNode; value: ReactNode; foot?: ReactNode; hero?: boolean; valueClass?: string }) {
  return (
    <div className="kpi">
      <div className="label">{props.label}</div>
      <div className={`value ${props.hero ? 'hero' : ''} ${props.valueClass ?? ''}`}>{props.value}</div>
      {props.foot && <div className="foot">{props.foot}</div>}
    </div>
  );
}

export function Gain({ value, base }: { value: number; base?: number }) {
  return (
    <span className={tone(value)}>
      {money(value, { sign: true })}
      {base != null && base > 0 && <span> ({pct(value / base, 2, true)})</span>}
    </span>
  );
}

const TAX_LABEL: Record<TaxStatus, string> = {
  actual: '稅後（實際）',
  estimated: '稅後（預扣稅為估算）',
  netOnly: '稅後（僅有實收淨額）',
};

export function TaxBadge({ status }: { status: TaxStatus }) {
  return <span className={`badge ${status !== 'actual' ? 'est' : ''}`}>{TAX_LABEL[status]}</span>;
}

// 一組股利合計的稅務標註：全部實際 → 稅後；有估算或僅淨額 → 標出筆數
export function TotalsBadge({ t }: { t: DividendTotals }) {
  if (t.count === 0) return null;
  const parts: string[] = [];
  if (t.estimatedCount) parts.push(`${t.estimatedCount} 筆預扣稅為估算`);
  if (t.netOnlyCount) parts.push(`${t.netOnlyCount} 筆僅有淨額`);
  if (parts.length === 0) return <span className="badge">稅後（實際）</span>;
  return <span className="badge est">稅後（{parts.join('、')}）</span>;
}

export function Notice({ items, title }: { items: string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="notice" role="status">
      {title && <strong>{title}</strong>}
      <ul>
        {items.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? 'on' : ''} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
