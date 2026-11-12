import { formatSessionTime, normaliseColour } from '@f1archive/shared';

export interface Clock {
  stream_start_utc: string | null;
  gmt_offset: string | null;
}

export function circuitTime(tNs: number | null | undefined, c: Clock, seconds = true): string {
  if (tNs == null) return '';
  if (!c.stream_start_utc || c.gmt_offset == null) return `+${formatSessionTime(tNs, 0)}`;
  const d = new Date(Date.parse(c.stream_start_utc) + tNs / 1e6 + Number(c.gmt_offset) / 1e6);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${seconds ? `:${p(d.getUTCSeconds())}` : ''}`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

export function dayShort(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

export function sessionStart(local: string | null | undefined, utc: string | null | undefined): string {
  if (!utc) return '';
  const d = new Date(utc);
  const date = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const u = d.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  const m = local ? /T(\d{2}:\d{2})/.exec(local) : null;
  return m ? `${date}, ${m[1]} local (${u} UTC)` : `${date}, ${u} UTC`;
}

const FALLBACK = '#8b939f';
export function teamColour(c: string | null | undefined): string {
  return normaliseColour(c) ?? FALLBACK;
}

const TYRES: Record<string, string> = {
  SOFT: 'var(--tyre-soft)',
  SUPERSOFT: 'var(--tyre-soft)',
  HYPERSOFT: 'var(--tyre-soft)',
  ULTRASOFT: 'var(--tyre-soft)',
  MEDIUM: 'var(--tyre-medium)',
  HARD: 'var(--tyre-hard)',
  INTERMEDIATE: 'var(--tyre-inter)',
  WET: 'var(--tyre-wet)',
};
export function tyreColour(c: string | null | undefined): string {
  return (c && TYRES[c.toUpperCase()]) || 'var(--muted)';
}

export function toneClass(tone: string | null | undefined): string {
  return tone === 'green' || tone === 'yellow' || tone === 'sc' || tone === 'vsc' || tone === 'red' ? tone : '';
}
