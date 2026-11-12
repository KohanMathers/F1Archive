export async function notifySite(): Promise<void> {
  const token = process.env.CACHE_CLEAR_TOKEN;
  const base = (process.env.WEB_INTERNAL_URL ?? 'http://web:3000').replace(/\/$/, '');
  if (!token) {
    console.log('[notify] CACHE_CLEAR_TOKEN not set: the site will show the new data once its caches expire (up to an hour).');
    return;
  }
  try {
    const r = await fetch(`${base}/internal/revalidate`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) console.log('[notify] site caches cleared');
    else if (r.status === 404) console.warn(`[notify] ${base} refused the cache clear; check CACHE_CLEAR_TOKEN matches the server's.`);
    else console.warn(`[notify] cache clear incomplete (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.warn(`[notify] could not reach the site at ${base}: ${(e as Error).message}`);
  }
}
