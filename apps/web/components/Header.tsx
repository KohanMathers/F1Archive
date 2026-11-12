'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SearchInput } from './SearchField';

const NAV: { href: string; label: string; on: (p: string) => boolean }[] = [
  { href: '/seasons', label: 'Seasons', on: (p) => (p.startsWith('/seasons') && !p.endsWith('/viewer')) || p.startsWith('/circuits') },
  { href: '/drivers', label: 'Drivers', on: (p) => p.startsWith('/drivers') },
  { href: '/teams', label: 'Teams', on: (p) => p.startsWith('/teams') },
  { href: '/telemetry', label: 'Replay', on: (p) => p.startsWith('/telemetry') || p.endsWith('/viewer') },
  { href: '/compare', label: 'Compare laps', on: (p) => p.startsWith('/compare') },
  { href: '/research', label: 'Data', on: (p) => ['/research', '/data', '/docs', '/exports', '/missing'].some((x) => p.startsWith(x)) },
  { href: '/about', label: 'About', on: (p) => p.startsWith('/about') },
];

export function Header() {
  const path = usePathname() ?? '/';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => setOpen(false), [path]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <header className="hdr" data-open={open}>
      <div className="wrap">
        <Link href="/" className="mark">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          F1Archive
        </Link>
        <nav className="nav" aria-label="Main">
          {/* In the narrow-screen menu search comes first */}
          <form className="nav-search" role="search" onSubmit={submit}>
            <SearchInput aria-label="Search" placeholder="Search drivers, races, circuits, teams" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.on(path) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <form className="hdr-search" role="search" onSubmit={submit}>
          <SearchInput aria-label="Search" placeholder="Search drivers, races, circuits, teams" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <button className="btn menu-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Menu
        </button>
      </div>
    </header>
  );
}
