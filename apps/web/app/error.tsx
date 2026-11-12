'use client';

export default function Failed({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap page" style={{ maxWidth: 720 }}>
      <h1>This page could not be loaded</h1>
      <p className="t-muted" style={{ marginTop: 8 }}>
        The data service did not answer as expected. This is usually brief.
      </p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
