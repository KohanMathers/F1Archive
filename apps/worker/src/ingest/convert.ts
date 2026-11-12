export type Conv = 'text' | 'int' | 'bigint' | 'float' | 'bool' | 'json' | 'textarray';

export class ConversionError extends Error {
  constructor(
    public readonly table: string,
    public readonly column: string,
    public readonly value: unknown,
    public readonly want: Conv,
  ) {
    super(`Cannot convert ${table}.${column} value ${JSON.stringify(value)} to ${want}`);
  }
}

type Out = string | number | boolean | null;

function toInteger(v: unknown): number | undefined {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v;
    if (Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v);
    return undefined;
  }
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^[-+]?\d+$/.test(s)) return Number(s);
    if (/^[-+]?\d+\.0+$/.test(s)) return Number(s);
  }
  return undefined;
}

export function convert(v: unknown, want: Conv, table: string, column: string): Out {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '' && want !== 'text') return null;
  switch (want) {
    case 'text':
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      break;
    case 'int':
    case 'bigint': {
      const n = toInteger(v);
      if (n !== undefined) {
        if (want === 'int' && (n > 2147483647 || n < -2147483648)) break;
        return n;
      }
      break;
    }
    case 'float': {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v.trim())) return Number(v);
      break;
    }
    case 'bool': {
      if (v === 1 || v === 0) return v === 1;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === '1' || s === 'true') return true;
        if (s === '0' || s === 'false') return false;
      }
      if (typeof v === 'boolean') return v;
      break;
    }
    case 'json': {
      if (typeof v === 'string') {
        try {
          JSON.parse(v);
          return v;
        } catch {
          break;
        }
      }
      break;
    }
    case 'textarray': {
      if (typeof v === 'string') {
        try {
          const arr = JSON.parse(v) as unknown;
          if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) return pgArrayLiteral(arr);
        } catch {
          /* fall through */
        }
      }
      break;
    }
  }
  throw new ConversionError(table, column, v, want);
}

export function pgArrayLiteral(items: string[]): string {
  return `{${items.map((s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

export function copyField(v: Out): string {
  if (v === null) return '\\N';
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '\\N';
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}
