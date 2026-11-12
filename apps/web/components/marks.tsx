import Link from 'next/link';
import type { FeedState } from '@f1archive/shared';
import { teamColour, tyreColour } from '@/lib/time';
import { why, type WhyRef } from '@/lib/routes';

export function Driver({ code, colour, href, title }: { code: string | null | undefined; colour: string | null | undefined; href?: string; title?: string }) {
  const inner = (
    <>
      <i style={{ background: teamColour(colour) }} aria-hidden />
      {code ?? '?'}
    </>
  );
  return href ? (
    <Link href={href} className="drv" title={title}>
      {inner}
    </Link>
  ) : (
    <span className="drv" title={title}>
      {inner}
    </span>
  );
}

export function Tyre({ compound, age }: { compound: string | null | undefined; age?: number | null }) {
  if (!compound) return <span className="gap">-</span>;
  const c = tyreColour(compound);
  return (
    <span className="row" style={{ gap: 4 }} title={`${compound.toLowerCase()}${age != null ? `, ${age} laps old` : ''}`}>
      <span className="tyre" style={{ borderColor: c, color: c }}>
        {compound[0]}
      </span>
      {age != null && <span className="mono-sm t-muted">{age}</span>}
    </span>
  );
}

const STATE_WORDS: Record<FeedState, string> = {
  present: 'available',
  partial: 'partly available',
  no_data: 'nothing published',
  missing: 'not in the archive',
  not_imported: 'not imported here',
  upcoming: 'not run yet',
};

export function stateWords(s: FeedState): string {
  return STATE_WORDS[s];
}

export function Gap({ what, state, at: r }: { what?: string; state?: FeedState; at: WhyRef }) {
  return (
    <span className="gap">
      {[what, state ? stateWords(state) : null].filter(Boolean).join(': ') || 'Not available'}.{' '}
      <Link className="why" href={why(r)}>
        Why is this missing?
      </Link>
    </span>
  );
}

export function Missing({ title, state, refTo, children }: { title: string; state?: FeedState; refTo: WhyRef; children?: React.ReactNode }) {
  return (
    <div className="missing">
      <b>{title}</b>
      {state ? ` (${stateWords(state)})` : ''}. {children}{' '}
      <Link className="why" href={why(refTo)}>
        Why is this missing?
      </Link>
    </div>
  );
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i}>{it.href ? <Link href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}</span>
      ))}
    </nav>
  );
}

export function Title({ crumbs, children, sub, actions }: { crumbs?: { href?: string; label: string }[]; children: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="title">
      {crumbs && <Crumbs items={crumbs} />}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1>{children}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </header>
  );
}
