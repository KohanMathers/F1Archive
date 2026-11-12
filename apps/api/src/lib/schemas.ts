export const slug = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 80 } as const;
export const year = { type: 'integer', minimum: 1950, maximum: 2200 } as const;

export const seasonParams = { type: 'object', required: ['year'], properties: { year } } as const;
export const eventParams = { type: 'object', required: ['year', 'event'], properties: { year, event: slug } } as const;
export const sessionParams = {
  type: 'object',
  required: ['year', 'event', 'session'],
  properties: { year, event: slug, session: slug },
} as const;

export interface SessionParams {
  year: number;
  event: string;
  session: string;
}

export const ARCHIVE_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
export const TELEMETRY_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';

export const errorResponse = {
  type: 'object',
  properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
} as const;
