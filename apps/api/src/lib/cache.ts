export class Cache<V> {
  private static readonly all = new Set<Cache<unknown>>();
  static clearAll(): number {
    for (const c of Cache.all) c.clear();
    return Cache.all.size;
  }

  private map = new Map<string, { v: Promise<V>; exp: number }>();
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {
    Cache.all.add(this as Cache<unknown>);
  }

  get(key: string, load: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && hit.exp > now) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit.v;
    }
    const v = load();
    this.map.set(key, { v, exp: now + this.ttlMs });
    v.catch(() => this.map.delete(key));
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
    return v;
  }

  clear() {
    this.map.clear();
  }
}
