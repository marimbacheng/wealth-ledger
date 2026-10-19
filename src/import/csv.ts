// RFC 4180 CSV 解析：支援引號、引號內逗號與換行、"" 跳脫。Schwab 匯出每列尾端多一個逗號，保留為空欄位。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

// "$1,230.98" / "-$80.60" / "($1.00)" / "--" / "N/A" → number | undefined
export function parseMoney(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const t = raw.trim();
  if (t === '' || t === '--' || t.toUpperCase() === 'N/A') return undefined;
  const neg = t.startsWith('-') || (t.startsWith('(') && t.endsWith(')'));
  const n = Number(t.replace(/[()$,%\s+-]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return neg ? -n : n;
}

// "10/15/2026" → "2026-10-15"；也接受 "2026/10/15"、"2026-10-15"、"10/15/2026 as of 10/14/2026"
export function parseUsDate(raw: string): string | undefined {
  const t = raw.trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return undefined;
}
