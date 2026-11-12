'use client';

import { useEffect, useState } from 'react';
import type { EventSummary, SeasonSummary, SessionSummary } from '@f1archive/shared';
import { load } from '@/lib/client';

export interface Chosen {
  year: number;
  event: EventSummary;
  session: SessionSummary;
}

export function SessionSelect({
  initial,
  onChange,
  telemetryOnly = false,
}: {
  initial?: { year: number; event: string; session: string } | null;
  onChange: (c: Chosen | null) => void;
  telemetryOnly?: boolean;
}) {
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [year, setYear] = useState<number | null>(initial?.year ?? null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [ev, setEv] = useState(initial?.event ?? '');
  const [ses, setSes] = useState(initial?.session ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load<SeasonSummary[]>('/api/v1/seasons')
      .then((s) => {
        setSeasons(s);
        setYear((y) => y ?? s[0]?.year ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (year != null) load<EventSummary[]>(`/api/v1/seasons/${year}/events`).then(setEvents).catch((e) => setError(e.message));
  }, [year]);

  const event = events.find((e) => e.slug === ev) ?? null;
  const session = event?.sessions.find((s) => s.slug === ses) ?? null;
  useEffect(() => {
    onChange(event && session && year != null ? { year, event, session } : null);
  }, [event?.key, session?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const usable = (s: SessionSummary) => s.status === 'archived' && (!telemetryOnly || s.has_telemetry);
  return (
    <fieldset className="picker" aria-label="Session">
      <label className="f">
        Season
        <select value={year ?? ''} onChange={(e) => (setYear(Number(e.target.value)), setEv(''), setSes(''))}>
          {seasons.map((s) => (
            <option key={s.year} value={s.year}>
              {s.year}
            </option>
          ))}
        </select>
      </label>
      <label className="f">
        Event
        <select value={ev} onChange={(e) => (setEv(e.target.value), setSes(''))}>
          <option value="">Choose</option>
          {events.map((e) => {
            const ok = e.sessions.some(usable);
            return (
              <option key={e.slug} value={e.slug} disabled={!ok}>
                {e.is_testing ? 'Testing' : `Round ${e.round}`}: {e.name}
                {!ok ? (telemetryOnly ? ' (no telemetry)' : ' (not archived)') : ''}
              </option>
            );
          })}
        </select>
      </label>
      <label className="f">
        Session
        <select value={ses} onChange={(e) => setSes(e.target.value)} disabled={!event}>
          <option value="">Choose</option>
          {event?.sessions.map((s) => (
            <option key={s.slug} value={s.slug} disabled={!usable(s)}>
              {s.name}
              {s.status !== 'archived' ? ` (${s.status})` : telemetryOnly && !s.has_telemetry ? ' (no telemetry)' : ''}
            </option>
          ))}
        </select>
      </label>
      {error && <span className="err t-small">{error}</span>}
    </fieldset>
  );
}
