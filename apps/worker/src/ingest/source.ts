import Database from 'better-sqlite3';

export type SqliteDb = Database.Database;

export function openSource(path: string): SqliteDb {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.pragma('cache_size = -262144');
  return db;
}

export function tableExists(db: SqliteDb, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function tableColumns(db: SqliteDb, name: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(name) as { name: string }[]).map((r) => r.name);
}

export interface SubsetInfo {
  telemetrySessions: Set<string>;
  info: Record<string, string>;
}

export function readSubset(db: SqliteDb): SubsetInfo | null {
  if (!tableExists(db, '_subset_manifest')) return null;
  const rows = db.prepare('SELECT year, round, event, session FROM _subset_manifest').all() as {
    year: number;
    round: number;
    event: string;
    session: string;
  }[];
  const info: Record<string, string> = {};
  if (tableExists(db, '_subset_info')) {
    for (const r of db.prepare('SELECT key, value FROM _subset_info').all() as { key: string; value: string }[]) info[r.key] = r.value;
  }
  return { telemetrySessions: new Set(rows.map((r) => ctxKey(r.year, r.round, r.event, r.session))), info };
}

export function ctxKey(year: number, round: number, event: string, session: string): string {
  return `${year}|${round}|${event}|${session}`;
}
