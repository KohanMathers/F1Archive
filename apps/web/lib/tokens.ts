export interface Tokens {
  bg: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  trackCasing: string;
  trackLine: string;
  flagYellow: string;
  flagSc: string;
  flagRed: string;
  flagBlue: string;
  mono: string;
}

export function tokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string) => s.getPropertyValue(n).trim() || fallback;
  return {
    bg: v('--bg', '#ffffff'),
    panel: v('--panel', '#f9fafa'),
    line: v('--line', '#c4c8cd'),
    text: v('--text', '#0b0c0c'),
    muted: v('--muted', '#575e68'),
    accent: v('--accent', '#1759bc'),
    trackCasing: v('--track-casing', '#e1e3e5'),
    trackLine: v('--track-line', '#8a919b'),
    flagYellow: v('--flag-yellow', '#ffc107'),
    flagSc: v('--flag-sc', '#d07932'),
    flagRed: v('--flag-red', '#d4351c'),
    flagBlue: v('--flag-blue', '#1d70b8'),
    mono: '"Source Code Pro Variable", "Source Code Pro", monospace',
  };
}
