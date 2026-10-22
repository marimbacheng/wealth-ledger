// 交易時段（不含國定假日；假日多抓幾次也無妨）：台股 09:00–13:30 台北、美股 09:30–16:00 紐約，各多留 5 分鐘收尾
const SESSIONS = [
  { tz: 'Asia/Taipei', open: 9 * 60, close: 13 * 60 + 35 },
  { tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 + 5 },
];

function local(now: Date, tz: string): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function marketOpen(now = new Date()): boolean {
  return SESSIONS.some((s) => {
    const { weekday, minutes } = local(now, s.tz);
    return weekday !== 'Sat' && weekday !== 'Sun' && minutes >= s.open && minutes <= s.close;
  });
}
