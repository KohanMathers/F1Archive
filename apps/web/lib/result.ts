import { formatDelta, formatSessionTime } from '@f1archive/shared';

interface Row {
  laps: number | null;
  status: string | null;
  time_ns: number | null;
}

export function raceGap(r: Row, winner: Row | undefined, isWinner: boolean): string {
  if (isWinner) return r.time_ns != null ? formatSessionTime(r.time_ns, 3) : '';
  const finished = !r.status || r.status === 'Finished' || r.status === 'Lapped' || /^\+\d+ Laps?$/.test(r.status);
  if (!finished) return r.status ?? '';
  if (winner?.laps != null && r.laps != null && r.laps < winner.laps) {
    const n = winner.laps - r.laps;
    return `+${n} lap${n > 1 ? 's' : ''}`;
  }
  return r.time_ns != null ? formatDelta(r.time_ns) : (r.status ?? '');
}
