import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { LapRow, SessionDetail, TrackOutline } from '@f1archive/shared';
import { find, get } from '@/lib/server';
import { to, why } from '@/lib/routes';
import { Crumbs, Missing } from '@/components/marks';
import { Replay, type SessionTimeline } from '@/components/replay/Replay';

type P = { params: Promise<{ year: string; event: string; session: string }>; searchParams: Promise<{ drivers?: string; t?: string; mode?: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { year, event, session } = await params;
  const s = await find<SessionDetail>(`/sessions/${year}/${event}/${session}`);
  return { title: s ? `Replay: ${year} ${s.event_name}, ${s.name}` : 'Replay' };
}

export default async function ReplayPage({ params, searchParams }: P) {
  const { year, event, session } = await params;
  const q = await searchParams;
  if (!/^\d{4}$/.test(year)) notFound();
  const s = await find<SessionDetail>(`/sessions/${year}/${event}/${session}`);
  if (!s) notFound();
  const y = Number(year);
  const crumbs = [
    { href: '/seasons', label: 'Seasons' },
    { href: to.season(y), label: year },
    { href: to.event(y, event), label: s.event_name },
    { href: to.session(y, event, session), label: s.name },
    { label: 'Replay' },
  ];
  if (s.status !== 'archived') {
    return (
      <div className="wrap page">
        <Crumbs items={crumbs} />
        <Missing title="This session is not in the archive" state={s.status === 'upcoming' ? 'upcoming' : 'missing'} refTo={{ year: y, event, session, feed: 'session_info' }} />
      </div>
    );
  }
  const [timeline, outline, laps] = await Promise.all([
    get<SessionTimeline>(`/sessions/${year}/${event}/${session}/timeline`),
    get<TrackOutline>(`/sessions/${year}/${event}/${session}/track`),
    get<LapRow[]>(`/sessions/${year}/${event}/${session}/laps`),
  ]);
  const tel = s.feeds.find((f) => f.feed === 'telemetry')?.state;
  return (
    <div className="rp">
      <Crumbs items={crumbs} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, lineHeight: '32px' }}>
          {year} {s.event_name}: {s.name}
        </h1>
        <div className="row">
          <Link className="btn sm" href={to.session(y, event, session)}>
            Session data
          </Link>
          <Link className="btn sm" href={`/research?sessions=${s.key}`}>
            Download data
          </Link>
        </div>
      </div>
      {!s.has_telemetry && (
        <p className="note warn">
          {tel === 'not_imported'
            ? 'Telemetry for this session exists in the archive but is not imported into this copy.'
            : 'There is no telemetry for this session, so the map and traces stay empty. Race control, team radio and the timeline still work.'}{' '}
          <Link className="why" href={why({ year: y, event, session, feed: 'telemetry' })}>
            Why is this missing?
          </Link>
        </p>
      )}
      {s.notes.map((n) => (
        <p key={n} className="note">
          {n}
        </p>
      ))}
      <Replay
        detail={s}
        timeline={timeline}
        outline={outline}
        laps={laps}
        initial={{
          drivers: (q.drivers ?? '').split(',').filter((d) => /^\d{1,5}$/.test(d)),
          t: q.t && /^\d+$/.test(q.t) ? Number(q.t) : null,
          mode: q.mode === 'lap' ? 'lap' : 'time',
        }}
      />
    </div>
  );
}
