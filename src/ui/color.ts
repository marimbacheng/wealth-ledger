// OKLCH → sRGB hex（感知均勻的漸層用）。超出色域的值直接截斷到 0~1。
export function oklchToHex(L: number, C: number, hueDeg: number): string {
  const h = (hueDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    '#' +
    lin
      .map((x) => {
        const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

export interface RampSpec {
  hueFrom: number; // 最大那塊的色相
  hueTo: number; // 最小那塊的色相（相鄰色相，拉開鄰近色塊的差異）
  chroma: [number, number];
}

// 依占比排序後的漸層：亮色模式最大塊最深，暗色模式最大塊最亮（對比都落在最重要的那塊）
export function ramp(n: number, spec: RampSpec, mode: 'light' | 'dark'): string[] {
  const [Lbig, Lsmall] = mode === 'light' ? [0.32, 0.8] : [0.9, 0.5];
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return oklchToHex(
      Lbig + (Lsmall - Lbig) * t,
      spec.chroma[0] + (spec.chroma[1] - spec.chroma[0]) * t,
      spec.hueFrom + (spec.hueTo - spec.hueFrom) * t,
    );
  });
}

export const HOLDING_RAMP: RampSpec = { hueFrom: 235, hueTo: 165, chroma: [0.09, 0.1] }; // 靛藍 → 青綠
export const SECTOR_RAMP: RampSpec = { hueFrom: 30, hueTo: 95, chroma: [0.11, 0.11] }; // 赭紅 → 金黃
