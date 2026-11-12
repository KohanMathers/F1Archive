export const NS_PER_MS = 1_000_000;
export const NS_PER_S = 1_000_000_000;

export function nsToSeconds(ns: number): number {
  return ns / NS_PER_S;
}

export function secondsToNs(s: number): number {
  return Math.round(s * NS_PER_S);
}

export function formatLapTime(ns: number | null | undefined): string {
  if (ns === null || ns === undefined || !Number.isFinite(ns)) return '—';
  const totalMs = Math.round(ns / NS_PER_MS);
  const neg = totalMs < 0;
  const abs = Math.abs(totalMs);
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const ms = abs % 1000;
  const body = m > 0 ? `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}` : `${s}.${String(ms).padStart(3, '0')}`;
  return neg ? `-${body}` : body;
}

export function formatDelta(ns: number | null | undefined): string {
  if (ns === null || ns === undefined || !Number.isFinite(ns)) return '—';
  const s = ns / NS_PER_S;
  return `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(3)}`;
}

export function formatSessionTime(ns: number | null | undefined, decimals = 1): string {
  if (ns === null || ns === undefined || !Number.isFinite(ns)) return '—';
  const totalS = ns / NS_PER_S;
  const neg = totalS < 0;
  const abs = Math.abs(totalS);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const sStr = s.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sStr}` : `${m}:${sStr}`;
  return neg ? `-${body}` : body;
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-GB');
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  return Math.round(n).toLocaleString('en-GB');
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function normaliseColour(c: string | null | undefined): string | null {
  if (!c) return null;
  const hex = c.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}
