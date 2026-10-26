import type { ISODate } from './types';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function nowISO(): ISODate {
  return new Date().toISOString();
}

export function toDate(value: ISODate | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 2026-10-26 */
export function formatDate(value: ISODate | Date): string {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 10月26日 */
export function formatMonthDay(value: ISODate | Date): string {
  const d = toDate(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 10月26日 周一 */
export function formatDateWithWeekday(value: ISODate | Date): string {
  const d = toDate(value);
  return `${formatMonthDay(d)} ${WEEKDAYS[d.getDay()]}`;
}

/** 14:05 */
export function formatTime(value: ISODate | Date): string {
  const d = toDate(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 今天 14:05 / 昨天 09:12 / 10月20日 21:30 */
export function formatDateTime(value: ISODate | Date): string {
  const d = toDate(value);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return `今天 ${formatTime(d)}`;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${formatTime(d)}`;

  return `${formatMonthDay(d)} ${formatTime(d)}`;
}

/** 本地时区的 YYYY-MM-DD，用于按天聚合 */
export function dayKey(value: ISODate | Date): string {
  return formatDate(value);
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 3 天前 / 2026-09-01 */
export function relativeTime(value: ISODate | Date): string {
  const d = toDate(value);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return formatDate(d);
}

/** 最近 n 天的日期键，按时间升序，含今天 */
export function recentDayKeys(n: number): string[] {
  const keys: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i);
    keys.push(dayKey(d));
  }
  return keys;
}

/** 秒 -> mm:ss */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
