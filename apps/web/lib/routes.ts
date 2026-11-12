import type { FeedKey } from '@f1archive/shared';

export const to = {
  season: (y: number) => `/seasons/${y}`,
  event: (y: number, e: string) => `/seasons/${y}/${e}`,
  session: (y: number, e: string, s: string) => `/seasons/${y}/${e}/${s}`,
  replay: (y: number, e: string, s: string, drivers?: string[], t?: number) => {
    const q = new URLSearchParams();
    if (drivers?.length) q.set('drivers', drivers.join(','));
    if (t != null) q.set('t', String(Math.round(t)));
    const qs = q.toString();
    return `/seasons/${y}/${e}/${s}/viewer${qs ? `?${qs}` : ''}`;
  },
  driver: (id: string) => `/drivers/${id}`,
  team: (id: string) => `/teams/${id}`,
  circuit: (key: number) => `/circuits/${key}`,
  compare: (slots: string[]) => `/compare?${slots.map((s, i) => `${'abcd'[i]}=${s}`).join('&')}`,
};

export interface WhyRef {
  year: number;
  event: string;
  session?: string;
  feed: FeedKey;
  driver?: string;
  recording?: boolean;
}

export function why(r: WhyRef): string {
  const q = new URLSearchParams({ year: String(r.year), event: r.event, feed: r.feed });
  if (r.session) q.set('session', r.session);
  if (r.driver) q.set('driver', r.driver);
  if (r.recording) q.set('recording', '1');
  return `/missing?${q}`;
}
