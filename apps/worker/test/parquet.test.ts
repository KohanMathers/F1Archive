import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import parquet from '@dsnp/parquetjs';
import { describe, expect, it } from 'vitest';
import type { ExportColumn } from '@f1archive/db';
import { writeParquetFile } from '../src/export/run.js';

const cols: ExportColumn[] = [
  { name: 'session_key', type: 'text', description: '', sql: '' },
  { name: 'ts_ns', type: 'integer', description: '', sql: '' },
  { name: 'x', type: 'real', description: '', sql: '' },
  { name: 'deleted', type: 'boolean', description: '', sql: '' },
  { name: 'utc', type: 'timestamp', description: '', sql: '' },
];

async function* rows() {
  yield { session_key: '2021-abu-dhabi-race', ts_ns: 9374641082300, x: 0, deleted: false, utc: new Date('2021-12-12T13:00:00Z') };
  yield { session_key: '2021-abu-dhabi-race', ts_ns: 3467649600, x: null, deleted: null, utc: null };
}

describe('parquet export', () => {
  it('round-trips types exactly, keeping nulls distinct from zeros', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'f1a-pq-')), 'telemetry.parquet');
    let n = 0;
    await writeParquetFile(path, cols, rows(), async () => void n++);
    expect(n).toBe(2);
    const reader = await parquet.ParquetReader.openFile(path);
    const cur = reader.getCursor();
    const a = (await cur.next()) as Record<string, unknown>;
    const b = (await cur.next()) as Record<string, unknown>;
    await reader.close();
    expect(a.session_key).toBe('2021-abu-dhabi-race');
    expect(BigInt(a.ts_ns as bigint)).toBe(9374641082300n);
    expect(a.x).toBe(0);
    expect(a.deleted).toBe(false);
    expect((a.utc as Date).toISOString()).toBe('2021-12-12T13:00:00.000Z');
    expect(b.x ?? null).toBeNull();
    expect(b.deleted ?? null).toBeNull();
  });
});
