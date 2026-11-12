import { lowerIndex } from '@f1archive/shared';

type Listener = () => void;
class Signal {
  private ls = new Set<Listener>();
  subscribe(l: Listener) {
    this.ls.add(l);
    return () => void this.ls.delete(l);
  }
  protected notify() {
    for (const l of this.ls) l();
  }
}

type Block<T> = T | 'pending' | 'failed';
const ready = <T,>(b: Block<T> | undefined): b is T => b !== undefined && b !== 'pending' && b !== 'failed';

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

const POS_SPAN = 60e9;
const POS_MARGIN = 3e9;
interface PosSeries {
  ts_ns: number[];
  x: number[];
  y: number[];
}

const SMOOTH_MAX_GAP = 0.6e9;
const SG7 = [-2, 3, 6, 7, 6, 3, -2].map((c) => c / 21);

export function smoothTrack(s: PosSeries): PosSeries {
  const n = s.ts_ns.length;
  const x = s.x.slice();
  const y = s.y.slice();
  const fix = (i: number) => !(s.x[i] === 0 && s.y[i] === 0);
  const linked = (i: number) => s.ts_ns[i + 1]! - s.ts_ns[i]! <= SMOOTH_MAX_GAP && fix(i) && fix(i + 1);
  const runEnd = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) runEnd[i] = i < n - 1 && linked(i) ? runEnd[i + 1]! : i;
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && !linked(i - 1)) start = i;
    if (i - start < 3 || runEnd[i]! - i < 3) continue;
    let sx = 0;
    let sy = 0;
    for (let k = -3; k <= 3; k++) {
      sx += SG7[k + 3]! * s.x[i + k]!;
      sy += SG7[k + 3]! * s.y[i + k]!;
    }
    x[i] = sx;
    y[i] = sy;
  }
  return { ts_ns: s.ts_ns, x, y };
}

export function trackAt(s: PosSeries, t: number, maxGap: number): [number, number] | null {
  const ts = s.ts_ns;
  const i = lowerIndex(ts, t);
  if (i < 0 || i >= ts.length - 1) {
    return i >= 0 && ts[i] === t ? [s.x[i]!, s.y[i]!] : null;
  }
  const t0 = ts[i]!;
  const t1 = ts[i + 1]!;
  const h = t1 - t0;
  if (h > maxGap) return null;
  if (h <= 0) return [s.x[i]!, s.y[i]!];
  const u = (t - t0) / h;
  const near = (a: number, b: number) => a >= 0 && b < ts.length && ts[b]! - ts[a]! <= SMOOTH_MAX_GAP;
  const tangent = (v: number[], k: number) =>
    near(k - 1, k) && near(k, k + 1) ? (v[k + 1]! - v[k - 1]!) / (ts[k + 1]! - ts[k - 1]!) : (v[i + 1]! - v[i]!) / h;
  if (h > SMOOTH_MAX_GAP) return [s.x[i]! + (s.x[i + 1]! - s.x[i]!) * u, s.y[i]! + (s.y[i + 1]! - s.y[i]!) * u];
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  const one = (v: number[]) => h00 * v[i]! + h10 * h * tangent(v, i) + h01 * v[i + 1]! + h11 * h * tangent(v, i + 1);
  return [one(s.x), one(s.y)];
}

export class Positions extends Signal {
  private blocks = new Map<number, Block<Record<string, PosSeries>>>();
  private order: number[] = [];
  constructor(
    private api: string,
    private t0: number,
    private t1: number,
  ) {
    super();
  }
  private ix(t: number) {
    return Math.floor((t - this.t0) / POS_SPAN);
  }
  want(t: number, ahead: number) {
    for (let i = this.ix(t) - 1; i <= this.ix(t) + ahead; i++) {
      const from = this.t0 + i * POS_SPAN;
      if (i < 0 || from > this.t1 || this.blocks.has(i)) continue;
      this.blocks.set(i, 'pending');
      json<{ drivers: Record<string, PosSeries> }>(`${this.api}/positions?from_ns=${Math.round(from - POS_MARGIN)}&to_ns=${Math.round(from + POS_SPAN + POS_MARGIN)}`)
        .then((r) => {
          this.blocks.set(i, Object.fromEntries(Object.entries(r.drivers).map(([d, s]) => [d, smoothTrack(s)])));
          this.order.push(i);
          while (this.order.length > 40) this.blocks.delete(this.order.shift()!);
          this.notify();
        })
        .catch(() => {
          this.blocks.set(i, 'failed');
          setTimeout(() => this.blocks.delete(i), 5000);
        });
    }
  }
  has(t: number) {
    return ready(this.blocks.get(this.ix(t)));
  }
  at(t: number): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    const b = this.blocks.get(this.ix(t));
    if (!ready(b)) return out;
    for (const [d, s] of Object.entries(b)) {
      const p = trackAt(s, t, 2e9);
      if (!p) continue;
      const i = lowerIndex(s.ts_ns, t);
      if ((s.x[i] === 0 && s.y[i] === 0) || (s.x[i + 1] === 0 && s.y[i + 1] === 0)) continue;
      out.set(d, p);
    }
    return out;
  }
}

export const CHANNELS = ['speed', 'throttle', 'brake', 'rpm', 'gear', 'drs'] as const;
export type Channel = (typeof CHANNELS)[number];
export type CarSeries = { ts_ns: number[] } & Record<Channel, (number | null)[]>;
const CAR_SPAN = 120e9;
const empty = (): CarSeries => ({ ts_ns: [], speed: [], throttle: [], brake: [], rpm: [], gear: [], drs: [] });

export class CarData extends Signal {
  private blocks = new Map<string, Block<CarSeries>>();
  private order: string[] = [];
  constructor(
    private api: string,
    private t0: number,
    private t1: number,
  ) {
    super();
  }
  private ix(t: number) {
    return Math.floor((t - this.t0) / CAR_SPAN);
  }
  want(drivers: string[], from: number, to: number) {
    for (let i = this.ix(from); i <= this.ix(to); i++) {
      const start = this.t0 + i * CAR_SPAN;
      if (i < 0 || start > this.t1) continue;
      for (const d of drivers) {
        const k = `${d}/${i}`;
        if (this.blocks.has(k)) continue;
        this.blocks.set(k, 'pending');
        json<{ drivers: Record<string, CarSeries> }>(
          `${this.api}/telemetry?drivers=${d}&from_ns=${Math.round(start)}&to_ns=${Math.round(start + CAR_SPAN - 1)}&channels=${CHANNELS.join(',')}`,
        )
          .then((r) => {
            this.blocks.set(k, r.drivers[d] ?? empty());
            this.order.push(k);
            while (this.order.length > 80) this.blocks.delete(this.order.shift()!);
            this.notify();
          })
          .catch(() => {
            this.blocks.set(k, 'failed');
            setTimeout(() => this.blocks.delete(k), 5000);
          });
      }
    }
  }
  slice(d: string, from: number, to: number): { s: CarSeries; complete: boolean } {
    const s = empty();
    let complete = true;
    for (let i = this.ix(from); i <= this.ix(to); i++) {
      if (i < 0 || this.t0 + i * CAR_SPAN > this.t1) continue;
      const b = this.blocks.get(`${d}/${i}`);
      if (!ready(b)) {
        complete = false;
        continue;
      }
      const a = Math.max(0, lowerIndex(b.ts_ns, from));
      const z = Math.min(b.ts_ns.length - 1, lowerIndex(b.ts_ns, to) + 1);
      for (let k = a; k <= z; k++) {
        s.ts_ns.push(b.ts_ns[k]!);
        for (const c of CHANNELS) s[c].push(b[c][k] ?? null);
      }
    }
    return { s, complete };
  }
}

export interface LapSamples {
  lap: { lap_no: number; lap_time_ns: number | null; start_ns: number; end_ns: number; s1_ns: number | null; s2_ns: number | null; s3_ns: number | null };
  samples: Record<'ts_ns' | 'speed' | 'rpm' | 'gear' | 'throttle' | 'brake' | 'drs' | 'x' | 'y', (number | null)[]> | null;
  reason?: string;
}
const laps = new Map<string, Promise<LapSamples>>();
export function lapSamples(api: string, driver: string, lap: number): Promise<LapSamples> {
  const k = `${api}|${driver}|${lap}`;
  let p = laps.get(k);
  if (!p) {
    p = json<LapSamples>(`${api}/laps/${driver}/${lap}/telemetry`);
    p.catch(() => laps.delete(k));
    laps.set(k, p);
    if (laps.size > 200) laps.delete(laps.keys().next().value!);
  }
  return p;
}

export type Intervals = Record<string, { ts_ns: number[]; position: (number | null)[]; gap_to_leader: (string | null)[]; gap_to_car_ahead: (string | null)[] }>;

export function intervalAt(s: Intervals[string] | undefined, t: number) {
  if (!s) return null;
  const i = lowerIndex(s.ts_ns, t);
  return i < 0 ? null : { position: s.position[i] ?? null, leader: s.gap_to_leader[i] ?? null, ahead: s.gap_to_car_ahead[i] ?? null };
}

export const isLeaderText = (s: string | null) => !!s && /^LAP\s*\d+/i.test(s);

export function gapSeconds(s: string | null): number | null {
  if (!s) return null;
  if (isLeaderText(s)) return 0;
  const m = /^\+?(\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? Number(m[1]) : null;
}

export const drsOpen = (c: number | null) => (c == null ? null : c >= 10 ? 1 : 0);
