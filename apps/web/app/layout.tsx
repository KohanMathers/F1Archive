import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/open-sans';
import '@fontsource-variable/nunito-sans';
import '@fontsource-variable/source-code-pro';
import type { ArchiveStats } from '@f1archive/shared';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteNotice } from '@/components/SiteNotice';
import { find } from '@/lib/server';
import './globals.css';


export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? 'https://f1archive.org'),
  title: { default: 'F1Archive', template: '%s | F1Archive' },
  description: 'An independent, unofficial archive of Formula 1 timing, telemetry, team radio and race control data from 2018 onwards, with exports and a public API.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#1b3c79', width: 'device-width', initialScale: 1 };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const stats = await find<ArchiveStats>('/stats', 60).catch(() => null);
  return (
    <html lang="en-GB">
      <body className={stats?.deployment === 'subset' ? 'has-strip' : undefined}>
        <Header />
        <main>{children}</main>
        <Footer />
        <SiteNotice />
        {stats?.deployment === 'subset' && (
          <div className="strip" role="note">
            Development copy: telemetry for a few races only.
            <a href="/about#deployment">Which ones</a>
          </div>
        )}
      </body>
    </html>
  );
}
