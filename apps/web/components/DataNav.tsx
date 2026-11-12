import Link from 'next/link';

const ITEMS = [
  { href: '/research', label: 'Export builder' },
  { href: '/data', label: 'Tables' },
  { href: '/docs', label: 'API reference' },
  { href: '/docs#exports', label: 'Bulk exports', sub: true },
  { href: '/docs#telemetry', label: 'Telemetry windows', sub: true },
  { href: '/docs/gaps', label: 'Known gaps' },
  { href: '/api/docs', label: 'OpenAPI console' },
];

export function DataSection({ current, children }: { current: string; children: React.ReactNode }) {
  return (
    <div className="wrap page side">
      <nav aria-label="Data">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className={i.sub ? 'sub' : undefined} aria-current={i.href === current ? 'page' : undefined}>
            {i.label}
          </Link>
        ))}
      </nav>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
