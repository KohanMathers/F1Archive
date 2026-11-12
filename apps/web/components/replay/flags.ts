import type { TimelineEvent, TrackPeriod } from '@f1archive/shared';

export type SectorFlag = 'yellow' | 'double';
export type TrackFlag = 'red' | 'sc' | 'vsc' | null;

export interface FlagState {
  track: TrackFlag;
  sectors: ReadonlyMap<number, SectorFlag>;
  blue: ReadonlySet<string>;
}

const BLUE_HALF = 2.5e9;

const NONE: FlagState = { track: null, sectors: new Map(), blue: new Set() };

export function flagLookup(events: TimelineEvent[], periods: TrackPeriod[]): (t: number) => FlagState {
  const field = (e: TimelineEvent, k: string) => e.fields?.find(([name]) => name === k)?.[1];

  const times: number[] = [];
  const states: Map<number, SectorFlag>[] = [];
  let cur = new Map<number, SectorFlag>();
  for (const e of events) {
    if (e.type !== 'race_control') continue;
    const flag = field(e, 'Flag');
    const scope = field(e, 'Scope');
    if (!flag || !scope) continue;
    const next = new Map(cur);
    if (scope === 'Sector') {
      const n = Number(field(e, 'Sector'));
      if (!Number.isFinite(n)) continue;
      if (flag === 'YELLOW') next.set(n, 'yellow');
      else if (flag === 'DOUBLE YELLOW') next.set(n, 'double');
      else if (flag === 'CLEAR') next.delete(n);
      else continue;
    } else if (scope === 'Track' && flag === 'CLEAR') {
      next.clear();
    } else continue;
    cur = next;
    times.push(e.t_ns);
    states.push(cur);
  }

  const blues = events
    .filter((e) => e.type === 'race_control' && e.driver && field(e, 'Flag') === 'BLUE')
    .map((e) => ({ t: e.t_ns, driver: e.driver! }));

  const track = periods
    .map((p) => ({ from: p.from_ns, to: p.to_ns ?? Infinity, flag: (p.tone === 'red' || p.tone === 'sc' || p.tone === 'vsc' ? p.tone : null) as TrackFlag }))
    .filter((p) => p.flag);

  let memoT = NaN;
  let memo = NONE;
  return (t) => {
    if (t === memoT) return memo;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! <= t) lo = mid + 1;
      else hi = mid;
    }
    const sectors = lo ? states[lo - 1]! : NONE.sectors;
    const tf = track.find((p) => p.from <= t && t < p.to)?.flag ?? null;
    const blue = new Set<string>();
    for (const b of blues) if (b.t - BLUE_HALF <= t && t < b.t + BLUE_HALF) blue.add(b.driver);
    const sameBlue = blue.size === memo.blue.size && [...blue].every((d) => memo.blue.has(d));
    memoT = t;
    memo = memo.track === tf && memo.sectors === sectors && sameBlue ? memo : { track: tf, sectors, blue: sameBlue ? memo.blue : blue };
    return memo;
  };
}
