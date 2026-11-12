const cache = new Map<string, Promise<unknown>>();

export function load<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) {
        let m = r.statusText;
        try {
          m = ((await r.json()) as { error?: { message?: string } }).error?.message ?? m;
        } catch {
          /* keep status text */
        }
        throw new Error(m);
      }
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p as Promise<T>;
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? r.statusText);
  return j;
}
