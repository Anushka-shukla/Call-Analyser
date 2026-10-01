import { TZ } from './config';

// YYYY-MM-DD for a Date in IST.
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// "YYYY-MM-DD HH:mm:ss" in IST, the format Exotel's API filters expect.
export function istStamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

// Exotel returns times as "YYYY-MM-DD HH:mm:ss" in the account's time zone (IST for Indian accounts).
export function fromExotelTime(s?: string | null): string | null {
  if (!s) return null;
  if (s.includes('T')) return new Date(s).toISOString();
  return new Date(`${s.replace(' ', 'T')}+05:30`).toISOString();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return istDate(d);
}

export function isDay(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function fmtDay(day: string): string {
  return new Date(`${day}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
}

export function fmtTime(ts: string | Date | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function mmss(ms: number | null | undefined): string {
  return fmtDuration(Math.round((ms ?? 0) / 1000));
}
