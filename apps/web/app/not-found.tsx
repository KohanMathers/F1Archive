import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap page" style={{ maxWidth: 720 }}>
      <h1>Nothing at this address</h1>
      <p className="t-muted" style={{ marginTop: 8 }}>
        Seasons, events and sessions are named from their official names, for example <code>/seasons/2021/abu-dhabi/race</code>. Searching usually finds the right one.
      </p>
      <p>
        <Link className="link" href="/search">
          Search the archive
        </Link>{' '}
        or{' '}
        <Link className="link" href="/seasons">
          list the seasons
        </Link>
        .
      </p>
    </div>
  );
}
