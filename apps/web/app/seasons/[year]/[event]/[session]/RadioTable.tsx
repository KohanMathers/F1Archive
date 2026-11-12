'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { circuitTime, teamColour, type Clock } from '@/lib/time';
import { to } from '@/lib/routes';

export interface Clip {
  id: number;
  t_ns: number;
  utc: string | null;
  driver: string | null;
  abbreviation: string | null;
  full_name: string | null;
  team_name: string | null;
  team_colour: string | null;
  audio_url: string | null;
  bytes: number | null;
  source_url: string | null;
}

export function RadioTable({
  clips,
  clock,
  replay,
  missingHref,
}: {
  clips: Clip[];
  clock: Clock;
  replay: { y: number; event: string; session: string } | null;
  missingHref: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [driver, setDriver] = useState('');
  const [chain, setChain] = useState(false);
  const drivers = useMemo(() => [...new Map(clips.filter((c) => c.driver).map((c) => [c.driver!, c])).values()], [clips]);
  const shown = driver ? clips.filter((c) => c.driver === driver) : clips;

  function play(c: Clip) {
    const el = audio.current;
    if (!el || !c.audio_url) return;
    if (playing === c.id) return el.pause();
    el.dataset.id = String(c.id);
    el.src = c.audio_url;
    void el.play().catch(() => setPlaying(null));
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Driver" value={driver} onChange={(e) => setDriver(e.target.value)}>
          <option value="">All drivers, {clips.length} clips</option>
          {drivers.map((d) => (
            <option key={d.driver!} value={d.driver!}>
              {d.abbreviation ?? d.driver}, {clips.filter((c) => c.driver === d.driver).length} clips
            </option>
          ))}
        </select>
        <label className="chk t-small">
          <input type="checkbox" checked={chain} onChange={(e) => setChain(e.target.checked)} /> Play the next clip automatically
        </label>
      </div>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(Number(audio.current?.dataset.id))}
        onPause={() => !audio.current?.ended && setPlaying(null)}
        onEnded={() => {
          const cur = Number(audio.current?.dataset.id);
          setPlaying(null);
          if (!chain) return;
          const next = shown.slice(shown.findIndex((c) => c.id === cur) + 1).find((c) => c.audio_url);
          if (next) play(next);
        }}
      />
      <table className="tbl dense">
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            <th>Local time</th>
            <th>Channel</th>
            <th>Team</th>
            <th>Recording</th>
            {replay && <th />}
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id} style={playing === c.id ? { background: 'var(--selected)' } : undefined}>
              <td>
                {c.audio_url && (
                  <button className="play-sm" aria-label={playing === c.id ? 'Pause' : `Play ${c.abbreviation ?? ''} radio`} onClick={() => play(c)}>
                    {playing === c.id ? '❚❚' : '▶'}
                  </button>
                )}
              </td>
              <td className="mono-sm t-muted">{circuitTime(c.t_ns, clock)}</td>
              <td>
                <span className="drv">
                  <i style={{ background: teamColour(c.team_colour) }} />
                  {c.abbreviation ?? c.driver}
                </span>
              </td>
              <td className="t-muted">{c.team_name}</td>
              <td className="t-small">
                {c.audio_url ? (
                  <a className="link" href={`${c.audio_url}?download`} download>
                    mp3{c.bytes ? `, ${Math.round(c.bytes / 1024)} KB` : ''}
                  </a>
                ) : (
                  <span className="gap">
                    not held here.{' '}
                    <Link className="why" href={missingHref}>
                      Why?
                    </Link>
                  </span>
                )}
              </td>
              {replay && (
                <td>
                  <Link className="link t-small" href={to.replay(replay.y, replay.event, replay.session, c.driver ? [c.driver] : undefined, c.t_ns - 1e9)}>
                    Replay
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
