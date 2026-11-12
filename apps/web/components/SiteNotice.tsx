'use client';

import { useEffect, useRef, useState } from 'react';

interface Notice {
  message: string;
  expiry: string;
  set_at: string;
}

const CLOSED_KEY = 'f1archive.notice-closed';

function closedFor(setAt: string): boolean {
  try {
    return sessionStorage.getItem(CLOSED_KEY) === setAt;
  } catch {
    return false;
  }
}

function until(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

export function SiteNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/notice', { cache: 'no-store' })
      .then((r) => (r.status === 200 ? (r.json() as Promise<Notice>) : null))
      .then((n) => {
        if (live && n && Date.parse(n.expiry) > Date.now() && !closedFor(n.set_at)) setNotice(n);
      })
      .catch(() => {
        /* no notice */
      });
    return () => void (live = false);
  }, []);

  useEffect(() => {
    if (notice && dlg.current && !dlg.current.open) dlg.current.showModal();
  }, [notice]);

  if (!notice) return null;
  const close = () => {
    try {
      sessionStorage.setItem(CLOSED_KEY, notice.set_at);
    } catch {
      /* it will show again on the next page */
    }
    dlg.current?.close();
    setNotice(null);
  };

  return (
    <dialog
      ref={dlg}
      className="notice"
      aria-labelledby="notice-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Focus starts on the box (read by screen readers), not on the close button. */}
      <div className="notice-box" tabIndex={-1} autoFocus>
        <button className="notice-close" onClick={close} aria-label="Close this notice" title="Close">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h2 id="notice-title">Notice</h2>
        <p className="notice-msg">{notice.message}</p>
        <p className="t-small t-muted">Shown until {until(notice.expiry)}.</p>
      </div>
    </dialog>
  );
}
