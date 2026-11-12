import type { PoolClient } from '@f1archive/db';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { copyField } from './convert.js';

type Row = (string | number | boolean | null)[];

export async function copyRows(client: PoolClient, table: string, columns: string[], rows: Iterable<Row>): Promise<number> {
  let count = 0;
  const iterator = rows[Symbol.iterator]();
  const source = new Readable({
    read() {
      let chunk = '';
      while (chunk.length < 1 << 20) {
        const next = iterator.next();
        if (next.done) {
          if (chunk) this.push(chunk);
          this.push(null);
          return;
        }
        const r = next.value;
        let line = '';
        for (let i = 0; i < r.length; i++) {
          if (i) line += '\t';
          line += copyField(r[i] as string | number | boolean | null);
        }
        chunk += line + '\n';
        count++;
      }
      this.push(chunk);
    },
  });
  const sink = client.query(copyFrom(`COPY ${table} (${columns.join(', ')}) FROM STDIN`));
  await pipeline(source, sink);
  return count;
}
