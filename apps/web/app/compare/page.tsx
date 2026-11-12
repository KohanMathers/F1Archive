import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Title } from '@/components/marks';
import { Compare } from './Compare';

export const metadata: Metadata = { title: 'Compare laps', description: 'Overlay up to four laps from any session or season, aligned by distance, with the time delta between them.' };

export default function ComparePage() {
  return (
    <div className="wrap page">
      <Title sub="Up to four laps from any session, driver or season. Lap A is the reference; the others are measured against it. Laps are aligned by distance so that corners line up even when lap times differ.">
        Compare laps
      </Title>
      <Suspense fallback={<div className="skel" />}>
        <Compare />
      </Suspense>
    </div>
  );
}
