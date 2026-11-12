import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createPool, type Pool } from '@f1archive/db';

export const LIVETIMING_BASE = 'https://livetiming.formula1.com/static/';

export function radioRelPath(archivePath: string, clipPath: string): string | null {
  const rel = normalize(archivePath + clipPath);
  if (rel.startsWith('..') || rel.startsWith(sep) || rel.includes(`..${sep}`)) return null;
  if (!rel.toLowerCase().endsWith('.mp3')) return null;
  return rel;
}

interface ClipRow {
  id: number;
  archive_path: string | null;
  path: string | null;
}

export async function scanRadio(radioDir: string, pool?: Pool, log = console.log): Promise<{ available: number; total: number }> {
  if (!existsSync(radioDir) || !statSync(radioDir).isDirectory()) {
    throw new Error(`radio folder ${radioDir} does not exist here; nothing was changed`);
  }
  const own = !pool;
  const db = pool ?? createPool({ max: 2 });
  try {
    const rows = (
      await db.query<ClipRow>(`SELECT r.id, s.archive_path, r.path FROM team_radio r JOIN sessions s ON s.id = r.session_id`)
    ).rows;
    let available = 0;
    const updates: [number, boolean, number | null][] = [];
    for (const r of rows) {
      const rel = r.archive_path && r.path ? radioRelPath(r.archive_path, r.path) : null;
      let ok = false;
      let bytes: number | null = null;
      if (rel) {
        try {
          const st = statSync(join(radioDir, rel));
          ok = st.isFile() && st.size > 0;
          bytes = ok ? st.size : null;
        } catch {
          /* not present */
        }
      }
      if (ok) available++;
      updates.push([r.id, ok, bytes]);
    }
    for (let i = 0; i < updates.length; i += 5000) {
      const chunk = updates.slice(i, i + 5000);
      await db.query(
        `UPDATE team_radio t SET file_available = u.ok, file_bytes = u.bytes
         FROM unnest($1::bigint[], $2::bool[], $3::bigint[]) AS u(id, ok, bytes) WHERE t.id = u.id`,
        [chunk.map((u) => u[0]), chunk.map((u) => u[1]), chunk.map((u) => u[2])],
      );
    }
    log(`[radio] ${available} of ${rows.length} recordings present in ${radioDir}`);
    return { available, total: rows.length };
  } finally {
    if (own) await db.end();
  }
}

export interface FetchOptions {
  radioDir: string;
  only?: string[];
  delayMs?: number;
  log?: (m: string) => void;
}

export async function fetchRadio(opts: FetchOptions): Promise<void> {
  const log = opts.log ?? console.log;
  const pool = createPool({ max: 2 });
  try {
    const rows = (
      await pool.query<ClipRow & { key: string }>(
        `SELECT r.id, s.archive_path, r.path, e.year || '-' || e.slug || '-' || s.slug AS key
         FROM team_radio r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
         ORDER BY e.year, e.round, s.scheduled_start_utc, r.ts_ns`,
      )
    ).rows.filter((r) => !opts.only?.length || opts.only.some((p) => r.key === p || r.key.startsWith(`${p}-`)));
    log(`[radio] ${rows.length} clips selected`);
    let fetched = 0;
    let failed = 0;
    for (const r of rows) {
      const rel = r.archive_path && r.path ? radioRelPath(r.archive_path, r.path) : null;
      if (!rel) continue;
      const dest = join(opts.radioDir, rel);
      if (existsSync(dest) && statSync(dest).size > 0) continue;
      mkdirSync(dirname(dest), { recursive: true });
      const url = LIVETIMING_BASE + rel.split(sep).map(encodeURIComponent).join('/');
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'F1Archive radio mirror' } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const tmp = `${dest}.part`;
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
        renameSync(tmp, dest);
        fetched++;
      } catch (e) {
        failed++;
        try {
          unlinkSync(`${dest}.part`);
        } catch {
          /* nothing to clean */
        }
        log(`[radio] failed ${url}: ${(e as Error).message}`);
      }
      if ((fetched + failed) % 50 === 0 && fetched + failed > 0) log(`[radio] ${fetched} fetched, ${failed} failed`);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 150));
    }
    log(`[radio] done: ${fetched} fetched, ${failed} failed`);
    await scanRadio(opts.radioDir, pool, log);
  } finally {
    await pool.end();
  }
}
