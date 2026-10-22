// 最小的 .xlsx 讀取器：只取第一個工作表的儲存格文字。
// xlsx 是 zip 包 XML；用瀏覽器內建的 DecompressionStream 解壓，不另外載入試算表函式庫（約 400 KB）。

export function isZip(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

interface Entry {
  method: number;
  size: number;
  offset: number;
}

function zipEntries(buf: ArrayBuffer): Map<string, Entry> {
  const v = new DataView(buf);
  // 從尾端找 End of Central Directory（註解最長 64 KB）
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 檔');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const names = new TextDecoder();
  const out = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目錄損毀');
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    out.set(names.decode(new Uint8Array(buf, p + 46, nameLen)), { method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: ArrayBuffer, e: Entry): Promise<string> {
  const v = new DataView(buf);
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw new Error('zip 檔頭損毀');
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const data = new Uint8Array(buf, start, e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error(`不支援的壓縮方式 ${e.method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, k: string) =>
    k[0] === '#' ? String.fromCodePoint(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : Number(k.slice(1))) : (ENTITY[k] ?? m),
  );
}

// 一個 <si> 或 <is> 可能分成多段格式文字（<r><t>…</t></r>），全部接起來
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

export async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const entries = zipEntries(buf);
  const get = async (name: string) => {
    const e = entries.get(name);
    return e ? readEntry(buf, e) : undefined;
  };

  // 第一個工作表：workbook.xml 的第一個 <sheet> → rels 找實際路徑
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  const rid = wb?.match(/<sheet\s[^>]*>/)?.[0];
  const id = rid && (attr(rid, 'r:id') ?? attr(rid, 'id'));
  if (id && rels) {
    const rel = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'Id') === id);
    const target = rel && attr(rel, 'Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = await get(sheetPath);
  if (!sheet) throw new Error('找不到工作表');

  const sst = await get('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(rm[1], 'r') ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const c = ref ? colIndex(ref) : next;
      next = c + 1;
      const t = attr(cm[1], 't');
      const body = cm[2] ?? '';
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(raw)] ?? '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (raw != null) val = unescapeXml(raw);
      row[c] = val;
    }
    rows[r] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
