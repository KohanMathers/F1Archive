import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { FEEDS, formatLapTime, isRaceLike, type FeedKey, type FeedState, type LapRow, type SessionDetail } from '@f1archive/shared';
import { find, get } from '@/lib/server';
import { raceGap } from '@/lib/result';
import { to, why } from '@/lib/routes';
import { circuitTime, sessionStart, teamColour } from '@/lib/time';
import { Driver, Gap, Missing, stateWords, Title, Tyre } from '@/components/marks';
import { Plot } from '@/components/Plot';
import { RadioTable, type Clip } from './RadioTable';

type P = { params: Promise<{ year: string; event: string; session: string }>; searchParams: Promise<{ tab?: string; driver?: string }> };

const TABS = [
  ['results', 'Results'],
  ['laps', 'Laps'],
  ['weather', 'Weather'],
  ['race-control', 'Race control'],
  ['radio', 'Team radio'],
  ['data', 'Data availability'],
] as const;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { year, event, session } = await params;
  const s = await find<SessionDetail>(`/sessions/${year}/${event}/${session}`);
  return { title: s ? `${year} ${s.event_name}, ${s.name}` : 'Session' };
}

export default async function SessionPage({ params, searchParams }: P) {
  const { year, event, session } = await params;
  const { tab: t, driver } = await searchParams;
  if (!/^\d{4}$/.test(year)) notFound();
  const s = await find<SessionDetail>(`/sessions/${year}/${event}/${session}`);
  if (!s) notFound();
  const y = Number(year);
  const tab = TABS.some(([k]) => k === t) ? t! : 'results';
  const state = (k: FeedKey) => s.feeds.find((f) => f.feed === k)?.state;
  const at = (feed: FeedKey, d?: string) => ({ year: y, event, session, feed, driver: d });
  const base = to.session(y, event, session);
  const firstTel = s.drivers.find((d) => d.telemetry === 'present')?.number;

  return (
    <div className="wrap page">
      <Title
        crumbs={[{ href: '/seasons', label: 'Seasons' }, { href: to.season(y), label: year }, { href: to.event(y, event), label: s.event_name }, { label: s.name }]}
        sub={`${sessionStart(s.start_local, s.start_utc)}${s.circuit ? `, ${s.circuit}` : ''}${s.total_laps ? `. ${s.total_laps} laps.` : '.'}`}
        actions={
          s.status === 'archived' && (
            <>
              {s.has_telemetry ? (
                <Link className="btn primary" href={to.replay(y, event, session, s.drivers.slice(0, 2).map((d) => d.number))}>
                  Open replay
                </Link>
              ) : null}
              {firstTel && (
                <Link className="btn" href={to.compare([`${y}/${event}/${session}/${firstTel}/fastest`])}>
                  Compare laps
                </Link>
              )}
              <Link className="btn" href={`/research?sessions=${s.key}`}>
                Download data
              </Link>
            </>
          )
        }
      >
        {year} {s.event_name}: {s.name}
      </Title>
      {s.notes.map((n) => (
        <p key={n} className="note">
          {n}
        </p>
      ))}
      {s.status === 'archived' && !s.has_telemetry && (
        <p className="t-muted">
          <Gap what="Telemetry" state={state('telemetry')} at={at('telemetry')} />
        </p>
      )}

      {s.status !== 'archived' ? (
        <Missing title="This session is not in the archive" state={s.status === 'upcoming' ? 'upcoming' : 'missing'} refTo={at('session_info')}>
          It is in the official schedule, but no data exists for it here.
        </Missing>
      ) : (
        <>
          <nav className="tabs" aria-label="Session data">
            {TABS.map(([k, label]) => (
              <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? 'page' : undefined} scroll={false}>
                {label}
              </Link>
            ))}
          </nav>
          {tab === 'results' && <Results s={s} y={y} event={event} session={session} st={state('results')} />}
          {tab === 'laps' && <Laps s={s} y={y} event={event} session={session} driver={driver} st={state('laps')} />}
          {tab === 'weather' && <Weather s={s} y={y} event={event} session={session} st={state('weather')} />}
          {tab === 'race-control' && <RaceControl s={s} y={y} event={event} session={session} st={state('race_control')} />}
          {tab === 'radio' && <Radio s={s} y={y} event={event} session={session} st={state('team_radio')} />}
          {tab === 'data' && <Availability s={s} y={y} event={event} session={session} />}
        </>
      )}
    </div>
  );
}

interface TP {
  s: SessionDetail;
  y: number;
  event: string;
  session: string;
  st?: FeedState;
}

interface Res {
  driver_number: string;
  driver_id: string | null;
  abbreviation: string;
  full_name: string | null;
  team_name: string | null;
  team_colour: string | null;
  constructor_id: string | null;
  position: number | null;
  position_text: string | null;
  grid_position: number | null;
  q1_ns: number | null;
  q2_ns: number | null;
  q3_ns: number | null;
  laps: number | null;
  status: string | null;
  points: number | null;
  time_ns: number | null;
  fastest_lap_rank: number | null;
  fastest_lap_time_ns: number | null;
}

async function Results({ s, y, event, session, st }: TP) {
  const rows = await get<Res[]>(`/sessions/${y}/${event}/${session}/results`);
  if (!rows.length) return <Missing title="No classification" state={st} refTo={{ year: y, event, session, feed: 'results' }} />;
  const race = isRaceLike(s.name) || (y === 2021 && s.name === 'Sprint Qualifying');
  const quali = !race && (s.kind === 'qualifying' || s.kind === 'sprint-qualifying');
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="pos">Pos</th>
            <th>Driver</th>
            <th />
            <th>Team</th>
            {race && <th className="n">Grid</th>}
            {race && <th className="n">Laps</th>}
            {race && <th className="n">Time, gap or reason</th>}
            {quali && <th className="n">Q1</th>}
            {quali && <th className="n">Q2</th>}
            {quali && <th className="n">Q3</th>}
            {!race && !quali && <th className="n">Best lap</th>}
            {!race && <th>Status</th>}
            {race && <th className="n">Points</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.driver_number}>
              <td className="pos mono-sm">{r.position_text ?? r.position}</td>
              <td>
                <Driver code={r.abbreviation} colour={r.team_colour} />
              </td>
              <td>
                {r.driver_id ? <Link href={to.driver(r.driver_id)}>{r.full_name}</Link> : r.full_name}
                {race && r.fastest_lap_rank === 1 && <span className="purple t-small"> fastest lap</span>}
              </td>
              <td className="t-muted">{r.constructor_id ? <Link href={to.team(r.constructor_id)}>{r.team_name}</Link> : r.team_name}</td>
              {race && <td className="n">{r.grid_position ?? ''}</td>}
              {race && <td className="n">{r.laps ?? ''}</td>}
              {race && <td className="n">{raceGap(r, rows[0], i === 0)}</td>}
              {quali && <td className="n">{r.q1_ns ? formatLapTime(r.q1_ns) : ''}</td>}
              {quali && <td className="n">{r.q2_ns ? formatLapTime(r.q2_ns) : ''}</td>}
              {quali && <td className="n">{r.q3_ns ? formatLapTime(r.q3_ns) : ''}</td>}
              {!race && !quali && <td className="n">{formatLapTime(r.fastest_lap_time_ns ?? r.q1_ns)}</td>}
              {!race && <td className="t-muted">{r.status}</td>}
              {race && <td className="n">{r.points ?? 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Laps({ s, y, event, session, driver, st }: TP & { driver?: string }) {
  const sel = s.drivers.find((d) => d.number === driver) ?? s.drivers[0];
  if (!sel) return <Missing title="No laps" state={st} refTo={{ year: y, event, session, feed: 'laps' }} />;
  const laps = await get<LapRow[]>(`/sessions/${y}/${event}/${session}/laps?driver=${sel.number}`);
  const timed = laps.filter((l) => l.lap_time_ns != null);
  const best = timed.reduce<number | null>((m, l) => (m == null || l.lap_time_ns! < m ? l.lap_time_ns! : m), null);
  const href = (n: string) => `${to.session(y, event, session)}?tab=laps&driver=${n}`;
  return (
    <>
      <div className="row" style={{ gap: 4, marginBottom: 16 }}>
        {s.drivers.map((d) => (
          <Link key={d.number} href={href(d.number)} scroll={false} className="tog" aria-pressed={d.number === sel.number} style={{ fontFamily: 'var(--mono)' }}>
            <span className="drv">
              <i style={{ background: teamColour(d.team_colour) }} />
              {d.abbreviation ?? d.number}
            </span>
          </Link>
        ))}
      </div>
      {laps.length === 0 ? (
        <Missing title={`No laps for ${sel.abbreviation}`} state={st === 'present' ? 'no_data' : st} refTo={{ year: y, event, session, feed: 'laps' }} />
      ) : (
        <>
          {timed.length > 2 && (
            <Plot height={180} xLabel="lap" trim yFormat={(v) => formatLapTime(v * 1e9)} series={[{ name: `${sel.abbreviation} lap time`, colour: teamColour(sel.team_colour), x: timed.map((l) => l.lap), y: timed.map((l) => l.lap_time_ns! / 1e9) }]} />
          )}
          <div className="tbl-wrap" style={{ marginTop: 16 }}>
            <table className="tbl dense">
              <thead>
                <tr>
                  <th className="n">Lap</th>
                  <th className="n">Time</th>
                  <th className="n">Sector 1</th>
                  <th className="n">Sector 2</th>
                  <th className="n">Sector 3</th>
                  <th>Tyre</th>
                  <th className="n">Pos</th>
                  <th className="n">Trap km/h</th>
                  <th>Notes</th>
                  {s.has_telemetry && sel.telemetry === 'present' && <th />}
                </tr>
              </thead>
              <tbody>
                {laps.map((l) => (
                  <tr key={l.lap}>
                    <td className="n">{l.lap}</td>
                    <td className={`n ${l.lap_time_ns === best ? 'purple' : ''}`} style={l.deleted ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                      {formatLapTime(l.lap_time_ns)}
                    </td>
                    <td className="n t-muted">{formatLapTime(l.s1_ns)}</td>
                    <td className="n t-muted">{formatLapTime(l.s2_ns)}</td>
                    <td className="n t-muted">{formatLapTime(l.s3_ns)}</td>
                    <td>
                      <Tyre compound={l.compound} age={l.tyre_age} />
                    </td>
                    <td className="n">{l.position ?? ''}</td>
                    <td className="n t-muted">{l.speed_st ?? ''}</td>
                    <td className="t-small t-muted">
                      {[l.pit_in_ns != null && 'pit in', l.pit_out_ns != null && 'pit out', l.deleted && `deleted${l.deleted_reason ? `: ${l.deleted_reason}` : ''}`].filter(Boolean).join(', ')}
                    </td>
                    {s.has_telemetry && sel.telemetry === 'present' && (
                      <td>{l.start_ns != null && <Link className="link t-small" href={to.compare([`${y}/${event}/${session}/${sel.number}/${l.lap}`])}>Compare</Link>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-small t-muted" style={{ marginTop: 8 }}>
            Purple is the driver’s fastest lap. Tyre compound is taken from the latest stint record before the end of each lap.
          </p>
        </>
      )}
    </>
  );
}

interface W {
  ts_ns: number;
  air_temp_c: number | null;
  track_temp_c: number | null;
  humidity_pct: number | null;
  pressure_mbar: number | null;
  rainfall: boolean | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
}

async function Weather({ s, y, event, session, st }: TP) {
  const w = await get<W[]>(`/sessions/${y}/${event}/${session}/weather`);
  if (!w.length) return <Missing title="No weather data" state={st} refTo={{ year: y, event, session, feed: 'weather' }} />;
  const range = (k: keyof W, unit: string) => {
    const v = w.map((r) => r[k]).filter((x): x is number => typeof x === 'number');
    return v.length ? `${Math.min(...v)} to ${Math.max(...v)} ${unit}` : 'not recorded';
  };
  const rain = w.filter((r) => r.rainfall).length;
  const x = w.map((r) => r.ts_ns / 6e10);
  const clock = { stream_start_utc: s.stream_start_utc, gmt_offset: s.gmt_offset };
  return (
    <>
      <dl className="kv" style={{ marginBottom: 24 }}>
        <dt>Air</dt>
        <dd className="mono">{range('air_temp_c', '°C')}</dd>
        <dt>Track</dt>
        <dd className="mono">{range('track_temp_c', '°C')}</dd>
        <dt>Humidity</dt>
        <dd className="mono">{range('humidity_pct', '%')}</dd>
        <dt>Wind</dt>
        <dd className="mono">{range('wind_speed_ms', 'm/s')}</dd>
        <dt>Rain</dt>
        <dd>{rain ? `reported in ${rain} of ${w.length} samples` : 'none reported'}</dd>
        <dt>Samples</dt>
        <dd>
          {w.length}, from {circuitTime(w[0]!.ts_ns, clock, false)} to {circuitTime(w.at(-1)!.ts_ns, clock, false)} local time
        </dd>
      </dl>
      <h3>Temperature</h3>
      <Plot
        height={200}
        xLabel="minutes from the start of the data stream"
        series={[
          { name: 'Track °C', colour: 'var(--flag-sc)', x, y: w.map((r) => r.track_temp_c) },
          { name: 'Air °C', colour: 'var(--accent)', x, y: w.map((r) => r.air_temp_c) },
        ]}
      />
      <h3 style={{ marginTop: 24 }}>Wind and humidity</h3>
      <Plot
        height={150}
        xLabel="minutes from the start of the data stream"
        series={[
          { name: 'Wind m/s', colour: 'var(--text)', x, y: w.map((r) => r.wind_speed_ms) },
          { name: 'Humidity %', colour: 'var(--muted)', x, y: w.map((r) => r.humidity_pct), right: true },
        ]}
      />
    </>
  );
}

interface Rc {
  id: number;
  ts_ns: number;
  message: string;
  category: string | null;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  driver_number: string | null;
  lap: number | null;
}

const FLAG_CLASS: Record<string, string> = { GREEN: 'green', CLEAR: 'green', YELLOW: 'yellow', 'DOUBLE YELLOW': 'yellow', RED: 'red' };

async function RaceControl({ s, y, event, session, st }: TP) {
  const rc = await get<Rc[]>(`/sessions/${y}/${event}/${session}/race-control`);
  if (!rc.length) return <Missing title="No race control messages" state={st} refTo={{ year: y, event, session, feed: 'race_control' }} />;
  const clock = { stream_start_utc: s.stream_start_utc, gmt_offset: s.gmt_offset };
  return (
    <div className="tbl-wrap">
      <table className="tbl dense">
        <thead>
          <tr>
            <th>Local time</th>
            <th className="n">Lap</th>
            <th>Flag</th>
            <th>Category</th>
            <th>Message</th>
            {s.has_telemetry && <th />}
          </tr>
        </thead>
        <tbody>
          {rc.map((m) => (
            <tr key={m.id}>
              <td className="mono-sm t-muted">{circuitTime(m.ts_ns, clock)}</td>
              <td className="n">{m.lap ?? ''}</td>
              <td>{m.flag ? <span className={`st ${FLAG_CLASS[m.flag] ?? ''}`}>{m.flag}</span> : ''}</td>
              <td className="t-muted">{m.category}</td>
              <td className="wrap-cell">{m.message}</td>
              {s.has_telemetry && (
                <td>
                  <Link className="link t-small" href={to.replay(y, event, session, undefined, m.ts_ns - 3e9)}>
                    Replay
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Radio({ s, y, event, session, st }: TP) {
  const clips = await get<Clip[]>(`/sessions/${y}/${event}/${session}/radio`);
  if (!clips.length) return <Missing title="No team radio" state={st} refTo={{ year: y, event, session, feed: 'team_radio' }} />;
  const held = clips.filter((c) => c.audio_url).length;
  return (
    <>
      <p className="t-muted">
        F1 published {clips.length} clips for this session and this archive holds {held} of the recordings. Clips are labelled by the car’s radio channel; F1 does not say who is speaking.{' '}
        {held > 0 && (
          <a className="link" href={`/media/radio/${y}/${event}/${session}.zip`}>
            Download all {held} recordings as a zip
          </a>
        )}
      </p>
      <RadioTable
        clips={clips}
        clock={{ stream_start_utc: s.stream_start_utc, gmt_offset: s.gmt_offset }}
        replay={s.has_telemetry ? { y, event, session } : null}
        missingHref={why({ year: y, event, session, feed: 'team_radio', recording: true })}
      />
    </>
  );
}

async function Availability({ s, y, event, session }: Omit<TP, 'st'>) {
  const av = await get<{ feeds: { feed: FeedKey; driver: string; state: FeedState; rows: number | null }[] }>(`/sessions/${y}/${event}/${session}/availability`);
  const main = av.feeds.filter((f) => !f.driver);
  return (
    <>
      <p className="t-muted">What the archive holds for this session, as recorded when it was imported.</p>
      <table className="tbl">
        <thead>
          <tr>
            <th>Feed</th>
            <th>State</th>
            <th className="n">Rows</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {main.map((f) => (
            <tr key={f.feed}>
              <td>
                {FEEDS[f.feed]?.label ?? f.feed}
                <div className="t-small t-muted" style={{ whiteSpace: 'normal' }}>
                  {FEEDS[f.feed]?.description}
                </div>
              </td>
              <td className={f.state === 'present' ? '' : 't-muted'}>{stateWords(f.state)}</td>
              <td className="n">{f.rows ?? ''}</td>
              <td>
                {f.state !== 'present' && (
                  <Link className="why" href={why({ year: y, event, session, feed: f.feed })}>
                    Why?
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ marginTop: 32 }}>Telemetry by driver</h2>
      <table className="tbl dense">
        <tbody>
          {s.drivers.map((d) => (
            <tr key={d.number}>
              <td>
                <Driver code={d.abbreviation} colour={d.team_colour} />
              </td>
              <td className="t-muted">{d.full_name}</td>
              <td className="n">{d.telemetry_samples ? `${d.telemetry_samples.toLocaleString('en-GB')} samples` : ''}</td>
              <td>{d.telemetry === 'present' ? '' : <Gap state={d.telemetry} at={{ year: y, event, session, feed: 'telemetry', driver: d.number }} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
