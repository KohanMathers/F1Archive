import { createHash, timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { ARCHIVE_TAG } from '@/lib/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const digest = (s: string) => createHash('sha256').update(s).digest();

export async function POST(req: Request) {
  const token = process.env.CACHE_CLEAR_TOKEN;
  const given = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token || !given || !timingSafeEqual(digest(given), digest(token))) return new Response('Not found', { status: 404 });

  let api: string | null = null;
  try {
    const r = await fetch(`${API}/api/internal/cache-clear`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) api = `API answered HTTP ${r.status}`;
  } catch (e) {
    api = `API unreachable: ${(e as Error).message}`;
  }
  revalidateTag(ARCHIVE_TAG);
  return api ? new Response(`Web cache cleared; ${api}`, { status: 502 }) : new Response(null, { status: 204 });
}
