import Link from 'next/link';
import type { Metadata } from 'next';
import type { SessionSummary } from '@f1archive/shared';
import { get } from '@/lib/server';
import { to } from '@/lib/routes';
import { day } from '@/lib/time';
import { Title } from '@/components/marks';
import { Open } from './Open';

export const metadata: Metadata = { title: 'Replay', description: 'Replay a session with car positions, telemetry traces, race control and team radio on one timeline.' };

export default async function ReplayIndex() {
  const sessions = await get<(SessionSummary & { event_name: string })[]>('/sessions?telemetry=true&limit=80');
  return (
    <div className="wrap page">
      <Title sub="Car positions on the circuit, speed, throttle, brake, gear, RPM and DRS for up to six drivers, with race control and team radio on the same timeline.">
        Replay a session
      </Title>
      <Open />
      <section className="sect">
        <h2>Sessions with telemetry</h2>
        <table className="tbl dense">
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.key}>
                <td className="mono-sm t-muted">{day(s.start_utc)}</td>
                <td>
                  <Link href={to.replay(s.year, s.event, s.slug)}>
                    {s.year} {s.event_name}
                  </Link>
                </td>
                <td>{s.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
