import { addDays, isDay, istDate } from './time';

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

export function dayParam(sp: Record<string, string | string[] | undefined>): string {
  const d = str(sp.date);
  return isDay(d) ? d : istDate();
}

export function rangeParam(sp: Record<string, string | string[] | undefined>, days = 7) {
  const to = isDay(str(sp.to)) ? (str(sp.to) as string) : istDate();
  const from = isDay(str(sp.from)) ? (str(sp.from) as string) : addDays(to, -(days - 1));
  return { from, to };
}

export function maskNumber(n: string | null | undefined): string {
  if (!n) return '-';
  const digits = n.replace(/\D/g, '');
  return digits.length <= 4 ? n : `xxxxxx${digits.slice(-4)}`;
}
