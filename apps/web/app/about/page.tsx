import Link from 'next/link';
import type { Metadata } from 'next';
import type { ArchiveStats } from '@f1archive/shared';
import { TRADEMARK_NOTICE } from '@f1archive/shared';
import { find } from '@/lib/server';
import { day } from '@/lib/time';
import { Title } from '@/components/marks';

export const metadata: Metadata = { title: 'About', description: 'What F1Archive is, where the data comes from, and what it is not.' };

const SAMPLE = [
  ['2018 Australian Grand Prix, race', 'car data only; no positions were published'],
  ['2018 Bahrain Grand Prix, race', 'no telemetry was published'],
  ['2021 British Grand Prix, sprint qualifying and race', ''],
  ['2021 Abu Dhabi Grand Prix, qualifying and race', ''],
  ['2023 Singapore Grand Prix, race', ''],
  ['2024 São Paulo Grand Prix, race', ''],
  ['2026 São Paulo Grand Prix, race', ''],
];

export default async function About() {
  const s = await find<ArchiveStats>('/stats', 60).catch(() => null);
  return (
    <div className="wrap page">
      <Title>About F1Archive</Title>
      <div className="prose">
        <p>
          F1Archive is an independent, unofficial archive of Formula 1 data. It keeps every session’s timing, telemetry, team radio, race control messages and weather from 2018 onwards, organised so that a single session is easy to find and the whole archive is easy to download.
        </p>
        <p>
          It records what the sources published and nothing more. When something is missing, the page says so and explains why, as far as that is known. Values are never estimated to fill a gap.
        </p>

        <h2 id="sources">Sources</h2>
        <ul>
          <li>The F1 live timing archive at livetiming.formula1.com: laps, telemetry, intervals, tyre stints, weather, race control, team radio and track status.</li>
          <li>Jolpica, the community continuation of the Ergast API: results, championship standings, pit stops, and driver, constructor and circuit reference data.</li>
          <li>MultiViewer: circuit corners, marshal lights and marshal sectors.</li>
        </ul>
        <p>
          Public availability does not make material free to redistribute. Team radio recordings, broadcast material and timing data can each carry their own rights. If you hold rights to something here and want it removed or credited differently, get in touch.
        </p>
        <p>
          The data here was pulled together by KmF1, a Go replacement to the FastF1 library, created by Kohan Mathers.
        </p>

        <h2 id="unofficial">Not affiliated</h2>
        <p>
          F1Archive is not operated, sponsored or endorsed by Formula One Management, Formula One Licensing, the FIA, or any team or driver. {TRADEMARK_NOTICE} They are used here only to name the subject.
        </p>

        <h2 id="deployment">This deployment</h2>
        {s ? (
          s.deployment === 'subset' ? (
            <>
              <p>
                This copy was built from a development subset. Every season, event and session is listed with its laps, results, weather, race control and radio messages, but telemetry is imported only for these sessions:
              </p>
              <ul>
                {SAMPLE.map(([n, note]) => (
                  <li key={n}>
                    {n}
                    {note && <span className="t-muted"> ({note})</span>}
                  </li>
                ))}
              </ul>
              <p>Elsewhere the telemetry is marked as not imported here, which is a property of this copy rather than a gap in the archive.</p>
            </>
          ) : (
            <p>This copy holds the full archive.</p>
          )
        ) : (
          <p className="t-muted">Deployment details are unavailable at the moment.</p>
        )}
        {s?.last_ingest_utc && <p className="t-muted">Last synchronised {day(s.last_ingest_utc)}.</p>}
        <p>
          The <Link href="/docs">API reference</Link> and the list of <Link href="/docs/gaps">known gaps</Link> describe the data in more detail.
        </p>
      </div>
    </div>
  );
}
