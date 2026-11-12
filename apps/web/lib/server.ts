import 'server-only';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export const ARCHIVE_TAG = 'archive';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function get<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, { next: { revalidate, tags: [ARCHIVE_TAG] } });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* status text will do */
    }
    throw new HttpError(res.status, message);
  }
  return (await res.json()) as T;
}

export async function find<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    return await get<T>(path, revalidate);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}
