import type { Metadata } from 'next';
import type { FeedDef, GapExplanation } from '@f1archive/shared';
import { get } from '@/lib/server';
import { DataSection } from '@/components/DataNav';
import { Title } from '@/components/marks';

export const metadata: Metadata = { title: 'Known gaps', description: 'Every documented gap in the archive and the reason for it.' };

const SOURCE: Record<GapExplanation['source'], string> = {
  'archive-documentation': 'archive records',
  'f1-side-research': "research into F1's archive",
  generic: 'general',
  deployment: 'this deployment',
};

export default async function Gaps() {
  const g = await get<{ documented: GapExplanation[]; feeds: FeedDef[]; derived_notes: Record<string, string> }>('/gaps', 3600);
  return (
    <DataSection current="/docs/gaps">
      <Title sub="Wherever data is missing on the site, a link explains that particular case. Missing values are never estimated or filled in.">Known gaps</Title>
      <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Gap</th>
            <th>Explanation</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {g.documented.map((d) => (
            <tr key={d.id}>
              <td className="wrap-cell" style={{ minWidth: 200, fontWeight: 500 }}>
                {d.title}
              </td>
              <td className="wrap-cell t-muted">{d.body.join(' ')}</td>
              <td className="t-muted t-small">{SOURCE[d.source]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h2 style={{ marginTop: 32 }}>Data copied from elsewhere</h2>
      <ul className="prose t-muted" style={{ paddingLeft: 18 }}>
        {Object.values(g.derived_notes).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <h2 style={{ marginTop: 32 }}>States</h2>
      <dl className="kv" style={{ maxWidth: '80ch' }}>
        <dt>available</dt>
        <dd>Real rows exist.</dd>
        <dt>partly available</dt>
        <dd>Telemetry only: either the car feed or the position feed was not published.</dd>
        <dt>nothing published</dt>
        <dd>The source answered with nothing. Either the feed does not apply to that kind of session or F1 never published it; the two cannot be told apart.</dd>
        <dt>not in the archive</dt>
        <dd>There is no record at all. The request failed or the session was never archived. Every full sync tries again.</dd>
        <dt>not imported here</dt>
        <dd>The archive has it, but this copy of the site was built without it.</dd>
      </dl>

      <h2 style={{ marginTop: 32 }}>Feeds</h2>
      <div className="tbl-wrap">
      <table className="tbl dense">
        <tbody>
          {g.feeds.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="t-muted">per {f.scope}</td>
              <td className="wrap-cell t-muted">
                {f.description}
                {f.allSessionTypes === false ? ' Races and sprints only.' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </DataSection>
  );
}
