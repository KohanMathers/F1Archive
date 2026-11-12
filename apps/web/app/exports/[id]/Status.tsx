'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatBytes, type ExportJob } from '@f1archive/shared';

const WORDS: Record<ExportJob['status'], string> = {
  queued: 'Waiting for the export worker',
  running: 'Building',
  done: 'Ready to download',
  failed: 'Failed',
  expired: 'Expired and deleted',
  cancelled: 'Cancelled',
};

export function Status({ id }: { id: string }) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/v1/exports/${id}`, { cache: 'no-store' });
        if (r.status === 404) throw new Error('There is no export with this address.');
        if (!r.ok) throw new Error(`Status check failed (${r.status}).`);
        const j = (await r.json()) as ExportJob;
        if (stop) return;
        setJob(j);
        setErr(null);
        if (j.status === 'queued' || j.status === 'running') timer = setTimeout(poll, 2000);
      } catch (e) {
        if (stop) return;
        setErr((e as Error).message);
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!job) return err ? <p className="err">{err}</p> : <p className="t-muted">Checking</p>;
  const total = job.progress.rows_total;
  const pct = total ? Math.min(100, (job.progress.rows_written / total) * 100) : null;
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Status</dt>
        <dd>{WORDS[job.status]}</dd>
        <dt>Format</dt>
        <dd>{job.request.format}</dd>
        <dt>Contents</dt>
        <dd>{job.request.categories.join(', ')}</dd>
        <dt>Sessions</dt>
        <dd>{job.request.sessions.length}</dd>
        {job.request.drivers?.length ? (
          <>
            <dt>Drivers</dt>
            <dd>{job.request.drivers.join(', ')}</dd>
          </>
        ) : null}
        <dt>Rows</dt>
        <dd className="mono">
          {job.progress.rows_written.toLocaleString('en-GB')}
          {total != null && job.status !== 'done' ? ` of about ${total.toLocaleString('en-GB')}` : ''}
        </dd>
        <dt>Export id</dt>
        <dd className="mono-sm">{job.id}</dd>
      </dl>
      {(job.status === 'queued' || job.status === 'running') && (
        <div>
          <div className="bar-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <span style={{ width: `${pct ?? 2}%` }} />
          </div>
          <p className="t-small t-muted" style={{ marginTop: 4 }}>
            {job.progress.stage ?? 'queued'}
          </p>
        </div>
      )}
      {job.status === 'done' && job.file && (
        <p>
          <a className="btn primary" href={job.file.url}>
            Download {job.file.name}, {formatBytes(job.file.bytes)}
          </a>
          {job.expires_utc && <span className="t-muted t-small"> Available until {new Date(job.expires_utc).toUTCString()}.</span>}
        </p>
      )}
      {job.status === 'failed' && <p className="err">{job.error}</p>}
      <p className="t-small t-muted">
        The zip holds the data, <code>README.md</code>, <code>schema.json</code> with the type and unit of every column, and <code>provenance.json</code>.{' '}
        <Link className="link" href="/research">
          Build another export
        </Link>
        .
      </p>
    </div>
  );
}
