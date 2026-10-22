import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { emptyStore } from '../src/domain/types';
import { computeLedgers } from '../src/engine/ledger';
import { importBytes, importText } from '../src/import';
import { isZip, readXlsxRows } from '../src/import/xlsx';
import { mergeBatch } from '../src/store/merge';

// 合成的 xlsx：自己組 zip（deflate），內容模仿永豐對帳單的欄位
function zip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = new Uint8Array(deflateRawSync(enc.encode(text)));
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, 8, true);
    lh.setUint32(18, data.length, true);
    lh.setUint16(26, nameB.length, true);
    local.push(new Uint8Array(lh.buffer), nameB, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, 8, true);
    ch.setUint32(20, data.length, true);
    ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((a, x) => a + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let p = 0;
  for (const x of parts) (out.set(x, p), (p += x.length));
  return out.buffer;
}

const HEADER = ['成交日', '市場', '商品', '買賣', '成交量', '成交均價', '成交價金', '手續費', '交易稅', '印花稅', '交所稅', '匯費', '管理費', '服務費', '交易徵費', '淨收付', '交割日', '計價幣別', '交割方式'];
const ROWS = [
  ['20261021', 'AAA.US', 'Alpha & Co', 'B', '3', '100.5', '301.5', '0.24', '0', '0', '0', '0', '0', '0', '0', '-301.74', '20261022', 'USD', '1'],
  ['20261021', 'BRK.B.US', 'Berkshire Hathaway - Class B', 'B', '2', '400', '800', '0.64', '0', '0', '0', '0', '0', '0', '0', '-800.64', '20261022', 'USD', '1'],
  ['20261105', 'AAA.US', 'Alpha & Co', 'S', '1', '110', '110', '0.09', '0', '0', '0', '0', '0', '0', '0.01', '109.9', '20261106', 'USD', '1'],
];

function xlsx(rows: string[][]): ArrayBuffer {
  const strings: string[] = [];
  const idx = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`)
    .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;');
  return zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="對帳單" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
  });
}

describe('xlsx 讀取', () => {
  it('讀出第一個工作表的每一格（共用字串、跳脫字元）', async () => {
    const buf = xlsx([HEADER, ...ROWS]);
    expect(isZip(buf)).toBe(true);
    const rows = await readXlsxRows(buf);
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1][2]).toBe('Alpha & Co');
    expect(rows).toHaveLength(ROWS.length + 1);
  });

  it('CSV 不是 zip', () => {
    expect(isZip(new TextEncoder().encode('日期,代號\n').buffer)).toBe(false);
  });
});

describe('永豐複委託對帳單', () => {
  it('xlsx 直接匯入：代號去掉市場碼、手續費加總、金額用淨收付', async () => {
    const b = await importBytes(xlsx([HEADER, ...ROWS]), '對帳單.xlsx');
    expect(b.kind).toBe('tw-statement');
    expect(b.warnings).toEqual([]);
    expect(b.txns).toHaveLength(3);
    expect(b.txns[0]).toMatchObject({ broker: 'tw', date: '2026-10-21', type: 'BUY', symbol: 'AAA', qty: 3, price: 100.5, fee: 0.24, amount: -301.74, currency: 'USD', source: 'sinopac-statement', note: '交割日 2026-10-22' });
    expect(b.txns[1].symbol).toBe('BRK.B');
    expect(b.txns[2]).toMatchObject({ type: 'SELL', fee: 0.1, amount: 109.9 });
    expect(b.securities.AAA).toEqual({ name: 'Alpha & Co' });
    expect(b.coverage).toEqual({ broker: 'tw', kind: 'transactions', from: '2026-10-21', to: '2026-11-05' });
  });

  it('另存成 CSV 也能匯入，結果相同', async () => {
    const csv = [HEADER, ...ROWS].map((r) => r.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')).join('\n');
    const a = importText(csv, '對帳單.csv');
    const b = await importBytes(xlsx([HEADER, ...ROWS]), '對帳單.xlsx');
    expect(a.txns).toEqual(b.txns);
  });

  it('淨收付和價金＋費用對不起來時提醒；不支援的幣別、看不懂的買賣別略過並提醒', () => {
    const bad = [
      ['20261021', 'AAA.US', 'Alpha', 'B', '1', '100', '100', '1', '0', '0', '0', '0', '0', '0', '0', '-105', '20261022', 'USD', '1'],
      ['20261021', '0700.HK', 'Tencent', 'B', '100', '400', '40000', '50', '0', '0', '0', '0', '0', '0', '0', '-40050', '20261023', 'HKD', '1'],
      ['20261021', 'AAA.US', 'Alpha', 'X', '1', '100', '100', '0', '0', '0', '0', '0', '0', '0', '0', '-100', '20261022', 'USD', '1'],
    ];
    const b = importText([HEADER, ...bad].map((r) => r.join(',')).join('\n'), 'x.csv');
    expect(b.txns).toHaveLength(1);
    expect(b.txns[0].amount).toBe(-105);
    expect(b.warnings).toHaveLength(3);
    expect(b.warnings[0]).toContain('對不起來');
    expect(b.warnings[1]).toContain('HKD');
    expect(b.warnings[2]).toContain('第 4 列');
  });

  it('對帳單的現金會計入永豐美元現金', async () => {
    const s = mergeBatch(emptyStore(), await importBytes(xlsx([HEADER, ...ROWS]), 'a.xlsx')).store;
    expect(computeLedgers(s, '2026-12-31').twCash).toBeCloseTo(-301.74 - 800.64 + 109.9, 6);
  });
});

describe('可能重複的成交', () => {
  it('同一筆成交從範本和對帳單各進來一次（拆單方式不同）時提醒', async () => {
    const tpl = `日期,券商,類別,代號,名稱,股數,價格,手續費,金額,稅前股利,預扣稅,稅後股利,再投入,備註,幣別,匯率
2026-10-21,tw,買進,AAA,Alpha,2,100.5,,,,,,,,USD,
2026-10-21,tw,買進,AAA,Alpha,1,100.5,,,,,,,,USD,
`;
    let s = mergeBatch(emptyStore(), importText(tpl, 'tpl.csv')).store;
    const r = mergeBatch(s, await importBytes(xlsx([HEADER, ...ROWS]), 'a.xlsx'));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('2026-10-21 AAA 買進：原本已有 2 筆共 3 股，這次又加入 1 筆共 3 股');
    // 同一份對帳單再匯一次：完全相同的紀錄直接略過，不提醒
    s = r.store;
    const again = mergeBatch(s, await importBytes(xlsx([HEADER, ...ROWS]), 'a.xlsx'));
    expect(again.added).toBe(0);
    expect(again.warnings).toEqual([]);
  });

  it('手續費更正後的新版對帳單：金額不同，提醒可能重複', async () => {
    const s = mergeBatch(emptyStore(), await importBytes(xlsx([HEADER, ...ROWS]), 'a.xlsx')).store;
    const fixed = ROWS.map((r) => (r[1] === 'AAA.US' && r[3] === 'B' ? [...r.slice(0, 7), '0.1', ...r.slice(8, 15), '-301.6', ...r.slice(16)] : r));
    const r = mergeBatch(s, await importBytes(xlsx([HEADER, ...fixed]), 'b.xlsx'));
    expect(r.added).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('AAA 買進');
  });
});

// 真實對帳單（不進版控的資料夾）；預期值從檔案本身推得，不寫死個人數字
const ROOT = join(__dirname, '..');
const real = readdirSync(ROOT)
  .filter((d) => /Schwab 資料$/.test(d) && existsSync(join(ROOT, d)))
  .flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => /對帳單.*\.xlsx$/.test(f)).map((f) => join(ROOT, d, f)));

describe.skipIf(real.length === 0)('真實永豐對帳單', () => {
  it.each(real)('%s：每列都能辨識，淨收付 = 價金 ± 費用', async (file) => {
    const buf = readFileSync(file);
    const b = await importBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), file);
    expect(b.kind).toBe('tw-statement');
    expect(b.warnings).toEqual([]);
    expect(b.txns.length).toBeGreaterThan(0);
    for (const t of b.txns) {
      expect(t.symbol).not.toMatch(/\.US$/);
      expect(t.fee).toBeGreaterThanOrEqual(0);
    }
  });
});
