import Link from 'next/link';
import type { Metadata } from 'next';
import type { FeedState, GapExplanation } from '@f1archive/shared';
import { HttpError, get } from '@/lib/server';
import { to } from '@/lib/routes';
import { DataSection } from '@/components/DataNav';
import { stateWords } from '@/components/marks';

export const metadata: Metadata = { title: 'Why is this missing?', robots: { index: false } };

interface Explain {
  context: { year: number; event: string; event_slug: string; session: string | null; session_slug: string | null; driver: string | null };
  feed: { key: string; label: string; description: string };
  state: FeedState;
  rows: number | null;
  explanation: GapExplanation;
}

const SOURCE: Record<GapExplanation['source'], string> = {
  'archive-documentation': 'Recorded in the archive’s documentation.',
  'f1-side-research': 'From research into why F1’s own archive lacks it; the database itself only shows that it is absent.',
  generic: 'No specific record exists for this gap, so this is the general explanation for its state.',
  deployment: 'This is about this copy of the site, not the archive.',
};

export default async function Why({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ['year', 'event', 'session', 'feed', 'driver']) if (sp[k]) q.set(k, sp[k]!);
  let d: Explain | null = null;
  let err: string | null = null;
  try {
    d = await get<Explain>(`/gaps/explain?${q}`);
  } catch (e) {
    err = e instanceof HttpError ? e.message : 'The explanation could not be loaded.';
  }
  const recording = sp.recording === '1';
  const where = d ? `${d.context.year} ${d.context.event}${d.context.session ? `, ${d.context.session}` : ''}${d.context.driver ? `, car ${d.context.driver}` : ''}` : '';

  return (
    <DataSection current="/docs/gaps">
      <header className="title">
        <div className="crumbs">Why is this missing?</div>
        {d && <h1>{recording ? 'Team radio recording' : d.feed.label}</h1>}
        {d && <div className="sub">{where}</div>}
      </header>
      {err && <p className="err">{err}</p>}
      {d && recording && (
        <div className="prose">
          <h2>F1 published this clip, but this copy of the archive does not hold the recording</h2>
          <p className="t-muted">
            The clip’s time and radio channel come from F1’s timing feed and are in the archive. The audio files are copied into the archive separately, and
            this one has not been copied here. Nothing is substituted for it.
          </p>
        </div>
      )}
      {d && !recording && (
        <div className="prose">
          <dl className="kv" style={{ marginBottom: 24 }}>
            <dt>State</dt>
            <dd>{stateWords(d.state)}</dd>
            {d.rows != null && d.rows > 0 && (
              <>
                <dt>Rows present</dt>
                <dd className="mono">{d.rows.toLocaleString('en-GB')}</dd>
              </>
            )}
            <dt>Could appear later</dt>
            <dd>{d.explanation.mayBeFilledLater ? 'Yes, a later sync may fill it in.' : 'No.'}</dd>
          </dl>
          <h2>{d.explanation.title}</h2>
          {d.explanation.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p className="t-small t-muted">{SOURCE[d.explanation.source]}</p>
          <h2>The feed</h2>
          <p className="t-muted">{d.feed.description}</p>
          <p className="t-muted">F1Archive does not estimate or fill in missing data.</p>
        </div>
      )}
      {d && (
        <p style={{ marginTop: 24 }}>
          <Link className="link" href={d.context.session_slug ? to.session(d.context.year, d.context.event_slug, d.context.session_slug) : to.event(d.context.year, d.context.event_slug)}>
            Back to {d.context.session_slug ? 'the session' : 'the event'}
          </Link>
        </p>
      )}
    </DataSection>
  );
}
