import Link from 'next/link';
import type { CalendarRound } from '@f1archive/shared';
import { to, why } from '@/lib/routes';
import { teamColour } from '@/lib/time';

function sketchPath(pts: [number, number][]): { d: string; box: string } {
  const p = pts.map(([x, y]) => [x, -y] as const);
  const n = p.length;
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]!;
    const p1 = p[i]!;
    const p2 = p[(i + 1) % n]!;
    const p3 = p[(i + 2) % n]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${Math.round(c1[0]!)},${Math.round(c1[1]!)} ${Math.round(c2[0]!)},${Math.round(c2[1]!)} ${p2[0]},${p2[1]}`;
  }
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  return { d: d + 'Z', box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}` };
}

function weekend(start: string | null, end: string | null): string {
  if (!start) return '';
  const f = (iso: string, month: boolean) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', ...(month ? { month: 'short' } : {}) });
  if (!end) return f(start, true);
  const sameMonth = new Date(start).getUTCMonth() === new Date(end).getUTCMonth();
  return `${f(start, !sameMonth)}\u2013${f(end, true)}`;
}

function surname(full: string | null): string | null {
  const last = full?.trim().split(/\s+/).at(-1);
  return last ? last.charAt(0) + last.slice(1).toLowerCase() : null;
}

export function SeasonCalendar({ year, rounds, now }: { year: number; rounds: CalendarRound[]; now: number }) {
  const next = rounds.find((r) => !r.winner && r.end_utc && Date.parse(r.end_utc) > now);
  return (
    <ol className="cal">
      {rounds.map((r) => {
        const done = !!r.winner;
        const isNext = r === next;
        const sk = r.sketch && r.sketch.length > 4 ? sketchPath(r.sketch) : null;
        const label = r.name.replace(/ Grand Prix$/, '');
        return (
          <li key={r.event} className={done ? 'done' : isNext ? 'next' : 'later'}>
            <span className="cal-top">
              <span className="mono-sm">R{r.round}</span>
              <span className="t-small">{weekend(r.start_utc, r.end_utc)}</span>
            </span>
            {sk ? (
              <svg className="cal-map" viewBox={sk.box} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${r.circuit ?? label} circuit${r.sketch_year ? `, layout as in ${r.sketch_year}` : ''}`}>
                <path d={sk.d} />
              </svg>
            ) : (
              <span className="cal-map cal-none t-small">
                No circuit drawing.{' '}
                <Link className="why" href={why({ year, event: r.event, feed: 'circuit_corners' })}>
                  Why?
                </Link>
              </span>
            )}
            {/* The name's link covers the whole cell (see .cal-link in globals.css). */}
            <Link href={to.event(year, r.event)} className="cal-link">
              {label}
            </Link>
            <span className="cal-foot t-small">
              {r.winner ? (
                <>
                  <i className="tc" style={{ background: teamColour(r.winner.team_colour) }} aria-hidden="true" />
                  {surname(r.winner.name) ?? r.winner.abbreviation}
                </>
              ) : isNext ? (
                <b className="cal-nextlabel">Next race{r.sketch_year ? <span className="t-muted">, {r.sketch_year} layout</span> : null}</b>
              ) : r.sketch_year ? (
                <span className="t-muted">Layout as in {r.sketch_year}</span>
              ) : (
                <span className="t-muted">{r.circuit}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
