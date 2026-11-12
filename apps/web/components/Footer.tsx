import Link from 'next/link';
import { TRADEMARK_NOTICE } from '@f1archive/shared';

export function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap">
        <div>
          <p style={{ maxWidth: 420 }}>
            F1Archive is an independent, unofficial archive of Formula 1 timing and telemetry data. It is not affiliated with Formula One Management, the
            FIA, any team or any driver.
          </p>
          <p style={{ maxWidth: 420, marginTop: 12 }}>{TRADEMARK_NOTICE}</p>
        </div>
        <div>
          <h3>Archive</h3>
          <Link href="/seasons">Seasons</Link>
          <Link href="/drivers">Drivers</Link>
          <Link href="/teams">Teams</Link>
          <Link href="/search">Search</Link>
        </div>
        <div>
          <h3>Data</h3>
          <Link href="/research">Export builder</Link>
          <Link href="/data">Tables</Link>
          <Link href="/docs">API reference</Link>
          <Link href="/docs/gaps">Known gaps</Link>
        </div>
        <div>
          <h3>Project</h3>
          <Link href="/about">About</Link>
          <Link href="/about#sources">Sources</Link>
          <Link href="/about#deployment">This deployment</Link>
        </div>
      </div>
    </footer>
  );
}
