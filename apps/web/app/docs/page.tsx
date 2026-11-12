import Link from 'next/link';
import type { Metadata } from 'next';
import { DataSection } from '@/components/DataNav';
import { Title } from '@/components/marks';

export const metadata: Metadata = { title: 'API reference', description: 'The F1Archive API: versioned endpoints, stable identifiers, units, telemetry windows and bulk exports.' };

const base = process.env.PUBLIC_BASE_URL ?? 'https://f1archive.org';

const ENDPOINTS: [string, string, string][] = [
  ['Archive', 'GET /api/v1/stats', 'Counts, computed from the database on request'],
  ['Archive', 'GET /api/v1/seasons', 'Seasons, with champions and how much is archived'],
  ['Archive', 'GET /api/v1/seasons/{year}', 'Events, sessions, team colours and standings of a season'],
  ['Archive', 'GET /api/v1/events/{year}/{event}', 'One event, its sessions and the standings after it'],
  ['Archive', 'GET /api/v1/sessions?telemetry=true', 'Archived sessions, optionally only those with telemetry'],
  ['Archive', 'GET /api/v1/drivers', 'Every driver who started a Grand Prix here'],
  ['Archive', 'GET /api/v1/drivers/{driverId}', 'A driver and every session they took part in'],
  ['Archive', 'GET /api/v1/teams', 'Every constructor and the names it raced under'],
  ['Archive', 'GET /api/v1/teams/{constructorId}', 'A constructor by season'],
  ['Archive', 'GET /api/v1/circuits/{key}', 'A circuit and the events held there'],
  ['Archive', 'GET /api/v1/search?q=', 'Search'],
  ['Session', 'GET …/sessions/{year}/{event}/{session}', 'Drivers, feed availability and time range'],
  ['Session', 'GET …/results', 'Classification'],
  ['Session', 'GET …/laps?driver=', 'Laps, sectors, speed traps, pit times, tyre'],
  ['Session', 'GET …/stints', 'Tyre stints'],
  ['Session', 'GET …/pit-stops', 'Pit stops'],
  ['Session', 'GET …/weather', 'Weather samples'],
  ['Session', 'GET …/race-control', 'Race control messages'],
  ['Session', 'GET …/radio', 'Team radio clips and recording addresses'],
  ['Session', 'GET …/intervals', 'Live timing position and gaps over the session'],
  ['Session', 'GET …/timeline', 'Track status periods and every event on one timeline'],
  ['Session', 'GET …/track', 'Circuit outline and corner positions'],
  ['Session', 'GET …/availability', 'State of every feed, per driver'],
  ['Telemetry', 'GET …/telemetry?drivers=&from_ns=&to_ns=&channels=', 'Up to 6 drivers, up to 15 minutes'],
  ['Telemetry', 'GET …/positions?from_ns=&to_ns=', 'x and y of every car, up to 5 minutes'],
  ['Telemetry', 'GET …/laps/{driver}/{lap}/telemetry', 'Every sample within one lap'],
  ['Telemetry', 'GET /api/v1/telemetry/{year}/{event}/{session}/{driver}', 'One driver, paged with next_from_ns'],
  ['Gaps', 'GET /api/v1/gaps', 'Documented gaps and the list of feeds'],
  ['Gaps', 'GET /api/v1/gaps/explain?year=&event=&session=&feed=&driver=', 'Why one feed is missing'],
  ['Exports', 'GET /api/v1/exports/schema', 'Columns, types and units of each category'],
  ['Exports', 'POST /api/v1/exports/estimate', 'Row and size estimate'],
  ['Exports', 'POST /api/v1/exports', 'Start an export'],
  ['Exports', 'GET /api/v1/exports/{id}', 'Progress'],
  ['Exports', 'GET /api/v1/exports/{id}/download', 'The finished zip'],
  ['Exports', 'GET /api/v1/data/{category}?sessions=', 'Paged rows, same columns as exports'],
  ['Radio', 'GET /media/radio/{year}/{event}/{session}/{id}.mp3', 'One recording; supports Range'],
  ['Radio', 'GET /media/radio/{year}/{event}/{session}.zip', 'All recordings of a session'],
];

export default function Docs() {
  return (
    <DataSection current="/docs">
      <Title
        sub={
          <>
            Versioned, read-only, no key needed. The interactive reference is at{' '}
            <a className="link" href="/api/docs">
              /api/docs
            </a>{' '}
            and the OpenAPI document at{' '}
            <a className="link" href="/api/docs/json">
              /api/docs/json
            </a>
            .
          </>
        }
      >
        API reference
      </Title>
      <div className="prose">
        <h2 id="conventions">Conventions</h2>
        <ul>
          <li>
            Durations and session times are whole nanoseconds, in fields ending <code>_ns</code>.
          </li>
          <li>
            Session time counts from the start of the session’s data stream, which usually begins about an hour before the session. Telemetry, laps, race control and radio all share it. A session’s <code>stream_start_utc</code> gives its UTC time; it is derived from team radio timestamps.
          </li>
          <li>
            Clock times are ISO 8601 in UTC, in fields ending <code>_utc</code>.
          </li>
          <li>
            A missing value is <code>null</code>. Zero is a measured zero.
          </li>
          <li>Speed is km/h, throttle is a percentage, temperatures are °C, pressure is mbar and wind is m/s. Car positions are in F1’s own track coordinates.</li>
          <li>Anything F1Archive computes rather than reads from the source, such as lap distance, is marked as derived.</li>
          <li>
            Telemetry is stored as the source has it. Car data and position data share one timeline; each row is a new sample of one of them, with the other’s last values repeated.
          </li>
        </ul>

        <h2 id="identifiers">Identifiers</h2>
        <p>
          A season is its year. Events and sessions are named from their official names: <code>2021/abu-dhabi/race</code>,{' '} <code>2023/qatar/sprint-shootout</code>, <code>2026/pre-season-testing-2/day-1</code>. A session key such as <code>2021-abu-dhabi-race</code> joins the files of an export. These stay the same when the database is rebuilt. Drivers are identified by car number within a session and by the Jolpica id (<code>max_verstappen</code>) across sessions.
        </p>
      </div>

      <h2 id="endpoints" style={{ marginTop: 32 }}>
        Endpoints
      </h2>
      <table className="tbl dense">
        <thead>
          <tr>
            <th>Group</th>
            <th>Request</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          {ENDPOINTS.map(([g, e, d]) => (
            <tr key={e}>
              <td className="t-muted">{g}</td>
              <td className="mono-sm">{e}</td>
              <td className="wrap-cell t-muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-small t-muted" style={{ marginTop: 8 }}>
        … stands for <code>/api/v1/sessions/{'{year}/{event}/{session}'}</code>.
      </p>

      <div className="prose">
        <h2 id="telemetry">Telemetry windows</h2>
        <p>Telemetry is requested by time window. A response holds one array per channel:</p>
        <pre>
          <code>{`curl '${base}/api/v1/sessions/2021/abu-dhabi/race/telemetry?drivers=33,44&from_ns=9070000000000&to_ns=9160000000000&channels=speed,throttle,brake'

{
  "session": "2021-abu-dhabi-race",
  "from_ns": 9070000000000,
  "to_ns": 9160000000000,
  "channels": ["speed", "throttle", "brake"],
  "drivers": {
    "33": { "ts_ns": [...], "speed": [...], "throttle": [...], "brake": [...] },
    "44": { ... }
  },
  "truncated": false,
  "next_from_ns": 9160000000001
}`}</code>
        </pre>
        <p>
          Follow <code>next_from_ns</code> to read a whole session. For one lap, use <code>/laps/33/58/telemetry</code>.
        </p>

        <h2 id="exports">Bulk exports</h2>
        <p>Large datasets are built in the background. Estimate, start, then poll:</p>
        <pre>
          <code>{`curl -X POST ${base}/api/v1/exports -H 'content-type: application/json' -d '{
  "format": "parquet",
  "categories": ["laps", "weather", "telemetry"],
  "selection": { "years": [2025, 2026], "session_kinds": ["race"] },
  "drivers": ["VER", "NOR"],
  "telemetry_channels": ["speed", "throttle", "brake"]
}'

curl ${base}/api/v1/exports/<id>
curl -OJ ${base}/api/v1/exports/<id>/download`}</code>
        </pre>
        <p>
          Formats are <code>csv</code>, <code>jsonl</code>, <code>json</code> (up to 5 million rows), <code>sqlite</code> and <code>parquet</code>. A request over the limits gets HTTP 422 with the reason and a suggested split.
        </p>

        <h2 id="missing">Missing data</h2>
        <p>
          Every feed of every session has a recorded state: <code>present</code>, <code>partial</code>, <code>no_data</code> (the source answered with nothing),{' '} <code>missing</code> (never retrieved), <code>not_imported</code> or <code>upcoming</code>. <code>/api/v1/gaps/explain</code> says why, and the{' '} <Link href="/docs/gaps">known gaps</Link> page lists the documented cases.
        </p>

        <h2 id="limits">Limits</h2>
        <p>
          Requests are rate-limited per address; the <code>x-ratelimit</code> headers show the budget. Telemetry windows are capped at 15 minutes and 400,000 samples, position windows at 5 minutes. Each client can have 3 exports in progress and start 20 an hour.
        </p>
      </div>
    </DataSection>
  );
}
