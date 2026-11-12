export function lowerIndex(sorted: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0 || (sorted[0] as number) > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((sorted[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function interpolateAt(
  ts: ArrayLike<number>,
  values: ArrayLike<number | null>,
  t: number,
  maxGap = Number.POSITIVE_INFINITY,
): number | null {
  const i = lowerIndex(ts, t);
  if (i < 0) return null;
  const v0 = values[i];
  if (i === ts.length - 1) return (ts[i] as number) === t ? (v0 ?? null) : null;
  const t0 = ts[i] as number;
  const t1 = ts[i + 1] as number;
  const v1 = values[i + 1];
  if (v0 === null || v0 === undefined || v1 === null || v1 === undefined) return t === t0 ? (v0 ?? null) : null;
  if (t1 - t0 > maxGap) return null;
  if (t1 === t0) return v0;
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

export function cumulativeDistance(tsNs: ArrayLike<number>, speedKmh: ArrayLike<number | null>): Float64Array {
  const n = tsNs.length;
  const out = new Float64Array(n);
  let d = 0;
  let prevT: number | null = null;
  let prevV: number | null = null;
  for (let i = 0; i < n; i++) {
    const t = tsNs[i] as number;
    const v = speedKmh[i] ?? null;
    if (v !== null && prevV !== null && prevT !== null) {
      const dt = (t - prevT) / 1e9;
      d += (((prevV + v) / 2) * dt) / 3.6;
    }
    out[i] = d;
    if (v !== null) {
      prevT = t;
      prevV = v;
    }
  }
  return out;
}

export interface LapTrace {
  elapsed: Float64Array;
  distance: Float64Array;
}

export function lapTrace(tsNs: ArrayLike<number>, speedKmh: ArrayLike<number | null>, lapStartNs: number): LapTrace {
  const n = tsNs.length;
  const elapsed = new Float64Array(n);
  for (let i = 0; i < n; i++) elapsed[i] = ((tsNs[i] as number) - lapStartNs) / 1e9;
  return { elapsed, distance: cumulativeDistance(tsNs, speedKmh) };
}

export function distanceDelta(a: LapTrace, b: LapTrace): (number | null)[] {
  const out: (number | null)[] = new Array(a.distance.length);
  for (let i = 0; i < a.distance.length; i++) {
    const d = a.distance[i] as number;
    const tb = interpolateMonotone(b.distance, b.elapsed, d);
    out[i] = tb === null ? null : tb - (a.elapsed[i] as number);
  }
  return out;
}

export function interpolateMonotone(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number | null {
  const n = xs.length;
  if (n === 0 || x < (xs[0] as number) || x > (xs[n - 1] as number)) return null;
  const i = lowerIndex(xs, x);
  if (i < 0) return null;
  if (i >= n - 1) return ys[n - 1] as number;
  const x0 = xs[i] as number;
  const x1 = xs[i + 1] as number;
  if (x1 === x0) return ys[i] as number;
  return (ys[i] as number) + (((ys[i + 1] as number) - (ys[i] as number)) * (x - x0)) / (x1 - x0);
}

export function minMaxDecimate(values: ArrayLike<number | null>, buckets: number): number[] {
  const n = values.length;
  if (n <= buckets * 2) return Array.from({ length: n }, (_, i) => i);
  const size = n / buckets;
  const idx: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(n, Math.floor((b + 1) * size));
    let minI = -1;
    let maxI = -1;
    for (let i = start; i < end; i++) {
      const v = values[i];
      if (v === null || v === undefined) continue;
      if (minI < 0 || v < (values[minI] as number)) minI = i;
      if (maxI < 0 || v > (values[maxI] as number)) maxI = i;
    }
    if (minI < 0) {
      idx.push(start);
      continue;
    }
    if (minI === maxI) idx.push(minI);
    else idx.push(Math.min(minI, maxI), Math.max(minI, maxI));
  }
  return idx;
}
