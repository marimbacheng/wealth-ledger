import { compactMoney, niceAxis, setDisplay, yearTicks } from '../src/ui/format';

describe('圖表座標軸', () => {
  afterEach(() => setDisplay('USD', undefined));

  it('美元用 k；台幣用萬（w），整數萬不留 .0', () => {
    setDisplay('USD', undefined);
    expect(compactMoney(49990)).toBe('$50k');
    expect(compactMoney(4999)).toBe('$5.0k');
    setDisplay('TWD', 32.5);
    expect(compactMoney(49990)).toBe('162.5w');
    expect(compactMoney(40000)).toBe('130w');
    expect(compactMoney(200)).toBe('6500');
    expect(compactMoney(400000)).toBe('1300w');
  });

  it('時間軸刻度在每年 1 月 1 日；沒跨年時只在起點標年份', () => {
    const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
    expect(yearTicks(d('2021-04-07'), d('2026-10-22'))).toEqual([2022, 2023, 2024, 2025, 2026].map((y) => Date.UTC(y, 0, 1)));
    expect(yearTicks(d('2026-10-15'), d('2026-10-22'))).toEqual([d('2026-10-15')]);
  });

  it('數值軸刻度在顯示幣別下是整數：美元每 2k、台幣每 10 萬', () => {
    setDisplay('USD', undefined);
    expect(niceAxis(48000, 48300).ticks.map((v) => compactMoney(v))).toEqual(['$42k', '$44k', '$46k', '$48k', '$50k', '$52k']);
    setDisplay('TWD', 32.4858);
    expect(niceAxis(48000, 48300).ticks.map((v) => compactMoney(v))).toEqual(['140w', '150w', '160w', '170w']);
  });
});
